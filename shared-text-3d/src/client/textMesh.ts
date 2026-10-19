import * as THREE from 'three';

export interface TextMeshOptions {
  width?: number;
  height?: number;
  fontSize?: number;
}

// Draws text on a 2D canvas, then uses that canvas as a texture on a 3D plane.
export function createTextMesh({ width = 1024, height = 512, fontSize = 44 }: TextMeshOptions = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported in this browser');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
  );

  const padding = 40;
  const lineHeight = fontSize * 1.3;

  // Split on newlines, then wrap long lines to the canvas width
  function wrap(text: string): string[] {
    const lines: string[] = [];
    text.split('\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        if (ctx!.measureText(line + ch).width > width - padding * 2) { lines.push(line); line = ch; }
        else line += ch;
      }
      lines.push(line);
    });
    return lines;
  }

  function setText(text: string): void {
    ctx!.clearRect(0, 0, width, height);
    ctx!.fillStyle = 'rgba(40, 44, 90, 0.85)';
    ctx!.fillRect(0, 0, width, height);

    ctx!.font = fontSize + 'px sans-serif';
    ctx!.fillStyle = '#ffffff';
    ctx!.textBaseline = 'top';

    const lines = wrap(text);
    // Keep the most recent lines visible if the text overflows
    const maxLines = Math.floor((height - padding * 2) / lineHeight);
    const visible = lines.slice(-maxLines);
    visible.forEach((line, i) => ctx!.fillText(line, padding, padding + i * lineHeight));

    // Simple caret after the last character
    const last = visible[visible.length - 1] ?? '';
    const x = padding + ctx!.measureText(last).width + 4;
    const y = padding + (visible.length - 1) * lineHeight;
    ctx!.fillRect(x, y, 3, fontSize);

    texture.needsUpdate = true;
  }

  setText('');
  return { mesh, setText };
}
