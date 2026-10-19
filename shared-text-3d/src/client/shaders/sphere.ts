// Plain strings tagged /* glsl */ for editor highlighting: no bundler, so no .glsl imports.
// Rendered as THREE.Points: each vertex is one particle on a sphere's surface.
// All distances are in world units = CSS pixels (see screenSpace.ts).

export const MAX_OTHERS = 8; // size of the uOthers* arrays below; JS must not send more

export const vertexShader = /* glsl */ `
  #define MAX_OTHERS ${MAX_OTHERS}

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uRadius;    // this sphere's radius in px
  uniform vec3  uColor;     // this sphere's colour

  // The OTHER spheres (every sphere except this one), in world space
  uniform vec3  uOthers[MAX_OTHERS];       // centres
  uniform vec3  uOtherColors[MAX_OTHERS];
  uniform float uOtherWeights[MAX_OTHERS]; // their presence 0..1: a leaving sphere's pull fades out, no snap
  uniform int   uOtherCount;

  attribute float aRandom;  // 0..1 per particle, de-syncs the animation

  varying float vTwinkle;
  varying float vMerge;     // 0 = untouched particle, 1 = fully part of a bridge
  varying float vSuck;      // 1 = particle reached the nozzle, fade it out
  varying vec3  vColor;

  void main() {
    // --- 1. Idle animation, in the sphere's LOCAL space (centre = 0,0,0) ---
    vec3 n = normalize(position);
    float wave = sin(n.x * 4.0 + uTime * 1.5) * sin(n.y * 5.0 + uTime * 1.1) * sin(n.z * 3.0 + uTime * 0.9);
    float jitter = 0.03 * sin(uTime * 3.0 + aRandom * 6.2832);
    vec3 local = position * (1.0 + 0.1 * wave + jitter);

    // --- 2. Into WORLD space ---
    // modelMatrix holds the sphere's spin and its position (= its window's centre).
    // Its 4th column is the translation, i.e. the sphere's centre in the world.
    vec4 world = modelMatrix * vec4(local, 1.0);
    vec3 center = modelMatrix[3].xyz;

    vec3 color = uColor;
    float merge = 0.0;
    float suck = 0.0;

    // --- 3. Merge with each other sphere ---
    for (int i = 0; i < MAX_OTHERS; i++) {
      if (i >= uOtherCount) break; // fixed-size loop + break works on every GPU

      vec3 toOther = uOthers[i] - center;
      float d = length(toOther);       // distance between the two centres
      if (d < 0.001) continue;          // same spot: no direction to stretch in
      vec3 dir = toOther / d;           // unit vector pointing at the other sphere

      // How strongly the two spheres attract:
      // smoothstep(2R, 3R, d) goes 0 -> 1 as d goes from touching (2R) to far (3R),
      // so 1 - smoothstep is 1 when touching and 0 when far apart.
      float strength = (1.0 - smoothstep(2.0 * uRadius, 3.0 * uRadius, d)) * uOtherWeights[i];

      // Where this particle sits relative to the axis between the two centres:
      vec3 rel = world.xyz - center;
      float along = dot(rel, dir);      // distance along the axis (negative = back side)
      vec3 lateral = rel - dir * along; // sideways offset from the axis
      // "facing" = dot(particle direction, direction to other), clamped: 1 at the point
      // nearest the other sphere, 0 at the equator and on the whole back half.
      float facing = clamp(along / uRadius, 0.0, 1.0);

      // Squared so only the near cap stretches, like the tip of a droplet
      float pull = strength * facing * facing;
      if (pull <= 0.0) continue;

      // Vacuum: each particle is sucked one way from the surface into the midpoint (d / 2),
      // then respawns on the surface. phase loops 0 -> 1; squaring it makes particles
      // accelerate into the nozzle. t: 0 = on the surface, 1 = at the midpoint.
      float phase = fract(uTime * (0.5 + 0.3 * strength) + aRandom * 7.0);
      float t = facing * phase * phase;
      float axial = mix(along, d * 0.5, t);
      // Funnel: sideways spread collapses toward the axis and swirls around it, faster
      // the deeper in, like a vortex. lateral is perpendicular to dir, so this is a
      // plain rotation about the axis.
      float swirl = 6.0 * t;
      vec3 spun = lateral * cos(swirl) + cross(dir, lateral) * sin(swirl);
      vec3 target = center + dir * axial + spun * mix(1.0, 0.05, t);

      world.xyz = mix(world.xyz, target, pull);
      // Fade out at the nozzle so the jump back to the surface is invisible
      suck = max(suck, pull * smoothstep(0.8, 1.0, phase));
      // Colour gradient along the neck: reaches a 50/50 mix at the midpoint
      // (the other sphere does the same from its side).
      color = mix(color, uOtherColors[i], 0.5 * pull * t);
      merge = max(merge, pull * t);
    }

    vMerge = merge;
    vSuck = suck;
    vColor = color;
    vTwinkle = 0.5 + 0.5 * sin(uTime * 4.0 + aRandom * 50.0);

    // world is already in world space, so skip modelMatrix: view, then projection
    gl_Position = projectionMatrix * viewMatrix * world;
    // Orthographic camera: no shrinking with distance, size is plain CSS px (times device pixels).
    // Bridge particles grow a little so the neck reads as dense.
    gl_PointSize = (1.5 + 2.5 * vTwinkle + 1.5 * merge) * uPixelRatio;
  }
`;

export const fragmentShader = /* glsl */ `
  uniform float uPresence;  // 0..1, fades a sphere in on join / out on leave
  varying float vTwinkle;
  varying float vMerge;
  varying float vSuck;
  varying vec3  vColor;

  void main() {
    // Soft round dot instead of the default square point
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d) * (0.3 + 0.7 * vTwinkle) * uPresence * (1.0 - vSuck);
    // Merging particles glow brighter (additive blending stacks them up too)
    gl_FragColor = vec4(vColor * (1.0 + 0.6 * vMerge), alpha);
    #include <colorspace_fragment>
  }
`;
