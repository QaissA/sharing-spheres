import * as THREE from 'three';

// THE SHARED WORLD
// Every window renders the same scene, whose coordinates are the user's physical
// screen in CSS pixels: world (x, y) = screen pixel (x, -y). Screen y grows DOWN,
// three.js y grows UP, hence the minus sign — that is the only flip anywhere.
// Each window's camera then looks at exactly the rectangle of screen it covers,
// so windows act like holes in a wall, all looking at the same big scene.

// Top-left corner of this page's content on the physical screen, in CSS px.
// screenX/screenY give the OUTER window corner, which includes browser chrome:
// - left/right borders: split the width difference evenly between both sides
// - top: the rest of the height difference is the tab strip + address bar
//   (minus a bottom border the same size as the side ones).
// shortcut: assumes 100% page zoom and no docked devtools; both skew inner vs outer sizes.
export function contentOrigin(): { x: number; y: number } {
  // Some contexts (hidden/automated windows) report outerWidth/outerHeight as 0: assume no chrome
  if (!outerWidth || !outerHeight) return { x: screenX, y: screenY };
  const border = (outerWidth - innerWidth) / 2;
  return {
    x: screenX + border,
    y: screenY + (outerHeight - innerHeight) - border,
  };
}

// Centre of this window's content, in screen px (y down).
export function windowCenter(): { x: number; y: number } {
  const o = contentOrigin();
  return { x: o.x + innerWidth / 2, y: o.y + innerHeight / 2 };
}

// Orthographic = no perspective, so 1 world unit stays 1 CSS pixel at every depth.
export function createScreenCamera() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  camera.position.z = 2000; // spheres sit around z = 0, well inside near..far

  // Call every frame: there is no "window moved" event, so we poll.
  function update(): void {
    const c = windowCenter();
    // Centre the camera on our window's centre (flip y into world space)...
    camera.position.x = c.x;
    camera.position.y = -c.y;
    // ...and make the visible box exactly as big as the window, in pixels.
    camera.left = -innerWidth / 2;
    camera.right = innerWidth / 2;
    camera.top = innerHeight / 2;
    camera.bottom = -innerHeight / 2;
    camera.updateProjectionMatrix();
  }

  update();
  return { camera, update };
}
