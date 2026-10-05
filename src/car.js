import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A purpose-built, original open-wheel car. Metres, +Z forward, ground at Y=0.
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const BODY_Y_SCALE = .84;
const BODY_Y_OFFSET = -.045;
const bodyHeight = y => y * BODY_Y_SCALE + BODY_Y_OFFSET;
// Keep axle lever arms and rolling radius aligned with physics.js. The origin
// is the ground projection of its center of mass, not the axle midpoint.
const WHEELBASE = 3.60;
const FRONT_AXLE_Z = 1.98;
const REAR_AXLE_Z = FRONT_AXLE_Z - WHEELBASE;
const WHEEL_RADIUS = .36;
const FRONT_TYRE_WIDTH = .305;
const REAR_TYRE_WIDTH = .405;
const HALF_TYRE_ENVELOPE = 1;
const FRONT_EXTENSION = FRONT_AXLE_Z - 1.65;
const frontZ = z => z + FRONT_EXTENSION * THREE.MathUtils.smoothstep(z, 1, 1.65);

function loft(sections, radial = 28, roundness = 1) {
  // Cubic longitudinal interpolation removes polygonal breaks in reflections.
  const controls = sections, smooth = [];
  for (let k = 0; k < controls.length - 1; k++) {
    const a = controls[k], b = controls[k + 1], before = controls[Math.max(0, k - 1)], after = controls[Math.min(controls.length - 1, k + 2)];
    const steps = Math.max(3, Math.ceil(Math.abs(b.z - a.z) / .12));
    for (let j = 0; j < steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t, s = { z: a.z + (b.z - a.z) * t };
      for (const key of ['x', 'y', 'w', 'h']) {
        const av = a[key] || 0, bv = b[key] || 0;
        const ma = (bv - (before[key] || 0)) / (b.z - before.z) * (b.z - a.z);
        const mb = ((after[key] || 0) - av) / (after.z - a.z) * (b.z - a.z);
        s[key] = (2 * t3 - 3 * t2 + 1) * av + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * bv + (t3 - t2) * mb;
        if (key === 'w' || key === 'h') s[key] = Math.max(.004, s[key]);
      }
      smooth.push(s);
    }
  }
  smooth.push(controls.at(-1)); sections = smooth;
  const p = [], uv = [], indices = [];
  for (let k = 0; k < sections.length; k++) {
    const s = sections[k];
    for (let i = 0; i <= radial; i++) {
      const a = i / radial * TAU;
      const cs = Math.cos(a), sn = Math.sin(a);
      p.push((s.x || 0) + Math.sign(cs) * Math.pow(Math.abs(cs), roundness) * s.w,
        s.y + Math.sign(sn) * Math.pow(Math.abs(sn), roundness) * s.h, s.z);
      uv.push(i / radial, k / (sections.length - 1));
      if (k && i < radial) {
        const j = k * (radial + 1) + i;
        indices.push(j, j - radial - 1, j + 1, j + 1, j - radial - 1, j - radial);
      }
    }
  }
  for (const k of [0, sections.length - 1]) {
    const s = sections[k], center = p.length / 3;
    p.push(s.x || 0, s.y, s.z); uv.push(.5, .5);
    for (let i = 0; i < radial; i++) {
      const j = k * (radial + 1) + i;
      if (k === 0) indices.push(center, j + 1, j);
      else indices.push(center, j, j + 1);
    }
  }
  // Sections run from rear to front. Reverse if caller supplies descending Z.
  if (sections[0].z > sections.at(-1).z) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

function tube(points, radius = .025, steps = 28, radial = 8) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), steps, radius, radial, false);
}

function panel(points, thickness = .014) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 2, steps: 1 });
}

function canvasTexture(width, height, draw) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function carbonTexture() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cell = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
    const strand = cell ? (x % 8) : (y % 8);
    const value = 25 + strand * 2.6 + (cell ? 3 : 0);
    const i = (y * size + x) * 4;
    data[i] = value * .88; data[i + 1] = value * .93; data[i + 2] = value; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 8); t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tireGeometry(width, radius = WHEEL_RADIUS) {
  // Lathed shoulder profile gives slicks their rounded, loaded-looking surface.
  const profile = [
    [.220, -width / 2 + .016], [.240, -width / 2 + .002],
    [.285, -width / 2], [.329, -width / 2 + .012],
    [radius - .007, -width / 2 + .038], [radius, -width / 2 + .070],
    [radius, width / 2 - .070], [radius - .007, width / 2 - .038],
    [.329, width / 2 - .012], [.285, width / 2],
    [.240, width / 2 - .002], [.220, width / 2 - .016],
  ];
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 64);
  g.rotateZ(Math.PI / 2);
  return g;
}

function wingGeometry(span, chord, camber = .032) {
  const p = [], uv = [], idx = [], steps = 12, across = 8;
  for (let j = 0; j <= across; j++) for (let i = 0; i <= steps; i++) {
    const t = i / steps, s = j / across * 2 - 1;
    const sweep = Math.abs(s) ** 1.8 * .055;
    const y = Math.sin(t * Math.PI) * camber + Math.abs(s) ** 2 * .022;
    p.push(s * span / 2, y, (t - .5) * chord + sweep);
    uv.push(j / across, t);
    if (j < across && i < steps) {
      const a = j * (steps + 1) + i, b = a + steps + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

export function createCar({ color = 0xb20c1c, ghost = false, mirrored = false } = {}) {
  const group = new THREE.Group(); group.name = 'Apex AP-25';
  const chassis = new THREE.Group(); chassis.name = 'chassis'; chassis.scale.y = BODY_Y_SCALE; chassis.position.y = BODY_Y_OFFSET; group.add(chassis);
  const suspension = new THREE.Group(); suspension.name = 'suspension'; group.add(suspension);
  const hiddenInCockpit = [];
  const mirrors = [];
  const resources = new Set();
  const labelTextures = new Set();
  const carbonMap = carbonTexture(); resources.add(carbonMap);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .08, roughness: .50, clearcoat: .08,
    clearcoatRoughness: .36, envMapIntensity: .23, ior: 1.35, specularIntensity: .32 });
  paint.color.multiplyScalar(.80);
  const carbon = new THREE.MeshStandardMaterial({ color: 0x444a50, map: carbonMap, metalness: .35, roughness: .47 });
  const satin = new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: .58, roughness: .38 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141519, metalness: .02, roughness: .94 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0x81868c, metalness: .9, roughness: .28 });
  const titanium = new THREE.MeshStandardMaterial({ color: 0x383c43, metalness: .9, roughness: .27 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: .4, metalness: .18 });
  const fabric = new THREE.MeshStandardMaterial({ color: 0x710916, roughness: .96, metalness: 0 });
  const glove = new THREE.MeshStandardMaterial({ color: 0xc0c4c6, roughness: .94, metalness: 0 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xdab553, metalness: .4, roughness: .37 });
  const black = new THREE.MeshStandardMaterial({ color: 0x030506, roughness: .92 });
  const redLight = new THREE.MeshStandardMaterial({ color: 0xff1928, emissive: 0xff0a16, emissiveIntensity: 2 });
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x254852, metalness: .9, roughness: .12, clearcoat: 1 });
  const materials = [paint, carbon, satin, rubber, alloy, titanium, white, fabric, glove, yellow, black, redLight, blue];
  materials.forEach(m => resources.add(m));
  function add(geometry, material, parent = chassis, pos, rot) {
    resources.add(geometry); resources.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    if (pos) mesh.position.set(...pos); if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = !ghost; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }
  function rod(a, b, r, material = carbon, parent = chassis, r2 = r) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), d = bv.clone().sub(av);
    const mesh = add(new THREE.CylinderGeometry(r2, r, d.length(), 8), material, parent);
    mesh.position.copy(av.add(bv).multiplyScalar(.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return mesh;
  }
  function decal(text, w, h, pos, rot = [0, 0, 0], tint = '#f4f1e8', font = '700', parent = chassis) {
    const texture = canvasTexture(1024, 256, (c, cw, ch) => {
      c.clearRect(0, 0, cw, ch); c.fillStyle = tint;
      c.font = `${font} 150px Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, cw / 2, ch / 2, cw - 25);
    });
    if (!texture) return null;
    resources.add(texture);
    labelTextures.add(texture);
    const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: .5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    const mesh = add(new THREE.PlaneGeometry(w, h), material, parent, pos, rot);
    mesh.userData.visualOnly = true;
    return mesh;
  }

  // Venturi floor, swept outer edge and diffuser. A real silhouette starts here.
  const floorShape = new THREE.Shape([
    new THREE.Vector2(-.19, frontZ(2.31)), new THREE.Vector2(.19, frontZ(2.31)), new THREE.Vector2(.35, .83),
    new THREE.Vector2(.78, .46), new THREE.Vector2(.86, -.91), new THREE.Vector2(.68, -1.18),
    new THREE.Vector2(.55, -1.40), new THREE.Vector2(.55, -1.93), new THREE.Vector2(.70, -2.07),
    new THREE.Vector2(.70, -2.24), new THREE.Vector2(-.70, -2.24), new THREE.Vector2(-.70, -2.07),
    new THREE.Vector2(-.55, -1.93), new THREE.Vector2(-.55, -1.40), new THREE.Vector2(-.68, -1.18),
    new THREE.Vector2(-.86, -.91), new THREE.Vector2(-.78, .46), new THREE.Vector2(-.35, .83),
  ]);
  const floor = new THREE.ExtrudeGeometry(floorShape, { depth: .035, bevelEnabled: true, bevelThickness: .006, bevelSize: .013, bevelSegments: 2 });
  floor.rotateX(Math.PI / 2);
  add(floor, carbon, chassis, [0, .175, 0]);
  for (const side of [-1, 1]) {
    add(tube([[side * .37, .21, .64], [side * .73, .16, .25], [side * .84, .17, -.74], [side * .55, .20, -1.45]], .016, 22, 6), carbon);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(.012, .11, .43), carbon, chassis, [side * (.51 + i * .1), .22, .35 - i * .06], [0, side * -.32, 0]);
  }
  for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(.013, .135, .55), carbon, chassis, [(i - 3) * .175, .24, -2.04], [-.15, 0, 0]);
  add(new THREE.BoxGeometry(1.12, .018, .57), carbon, chassis, [0, .31, -2.09], [-.18, 0, 0]);

  add(loft([
    { z: -1.96, y: .39, w: .17, h: .16 }, { z: -1.3, y: .40, w: .26, h: .21 },
    { z: -.78, y: .38, w: .32, h: .16 }, { z: -.5, y: .38, w: .335, h: .16 },
    { z: .20, y: .39, w: .31, h: .14 }, { z: .48, y: .47, w: .29, h: .23 },
    { z: .76, y: .48, w: .24, h: .23 }, { z: 1.22, y: .47, w: .166, h: .15 },
    { z: 1.93, y: .36, w: .107, h: .079 }, { z: 2.50, y: .285, w: .075, h: .055 },
    { z: 2.63, y: .275, w: .060, h: .037 },
  ].map(section => ({ ...section, z: frontZ(section.z) })), 32, .8), paint);

  // Deep black tub, with separate sculpted cockpit lips rather than a closed roof.
  add(loft([{ z: -.78, y: .547, w: .18, h: .012 }, { z: -.51, y: .55, w: .27, h: .016 },
    { z: .05, y: .547, w: .26, h: .012 }, { z: .44, y: .566, w: .16, h: .014 }], 24), black);
  const tubPositions = [], tubUV = [], tubIndices = [];
  for (let i = 0; i <= 40; i++) {
    const a = i / 40 * TAU, x = Math.sin(a) * .278, z = -.15 + Math.cos(a) * .56;
    tubPositions.push(x, .708 - Math.cos(a) * .016, z, x * .74, .49, z * .87);
    tubUV.push(i / 40, 1, i / 40, 0);
    if (i < 40) { const j = i * 2; tubIndices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const tubGeo = new THREE.BufferGeometry();
  tubGeo.setAttribute('position', new THREE.Float32BufferAttribute(tubPositions, 3));
  tubGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tubUV, 2));tubGeo.setIndex(tubIndices);tubGeo.computeVertexNormals();
  const tubMaterial = carbon.clone(); tubMaterial.color.setHex(0x15191c); tubMaterial.side = THREE.DoubleSide; tubMaterial.roughness = .72;
  add(tubGeo, tubMaterial);
  for (const s of [-1, 1]) {
    add(tube([[s * .17, .67, .44], [s * .265, .704, .17], [s * .285, .708, -.21], [s * .26, .727, -.58], [s * .15, .75, -.77]], .023, 36, 10), carbon);
    // Undercut sidepods and rounded shoulder / cooling inlet.
    add(loft([
      { z: -1.68, x: s * .29, y: .35, w: .07, h: .085 },
      { z: -1.2, x: s * .35, y: .375, w: .10, h: .11 },
      { z: -.62, x: s * .425, y: .415, w: .175, h: .13 },
      { z: -.08, x: s * .495, y: .475, w: .265, h: .19 },
      { z: .22, x: s * .51, y: .52, w: .275, h: .16 },
      { z: .50, x: s * .485, y: .55, w: .22, h: .12 },
      { z: .59, x: s * .47, y: .565, w: .19, h: .084 },
    ], 32, .65), paint);
    // Exposed carbon cooling shoulder breaks up the painted pod and visually
    // separates its downwash surface from the cockpit's narrow structural rim.
    add(loft([
      { z: -.73, x: s * .40, y: .519, w: .06, h: .004 },
      { z: -.43, x: s * .448, y: .588, w: .107, h: .005 },
      { z: -.08, x: s * .495, y: .664, w: .14, h: .005 },
      { z: .22, x: s * .51, y: .679, w: .135, h: .004 },
      { z: .44, x: s * .49, y: .678, w: .094, h: .003 },
    ], 20, .85), carbon);
    const inlet = add(new THREE.SphereGeometry(1, 24, 12), black, chassis, [s * .47, .567, .609]);
    inlet.scale.set(.170, .051, .014);
    add(tube([[s * .286, .557, .613], [s * .38, .63, .611], [s * .57, .63, .611], [s * .655, .567, .61]], .012, 18, 6), carbon);
    // Curved engine cooling louvres.
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(.13, .006, .025), black, chassis,
      [s * (.50 - i * .025), .652 - i * .027, -.16 - i * .114], [0, s * .28, s * -.15]);
    decal('APEX', .38, .105, [s * .788, .51, .08], [0, s * Math.PI / 2, 0]);
    decal('M O T O R S P O R T', .30, .036, [s * .785, .425, .07], [0, s * Math.PI / 2, 0], '#eee8d8', '500');
  }
  // Carbon bulkhead cover directly ahead of the wheel, over the footwell.
  add(loft([
    { z: .29, y: .583, w: .20, h: .007 },
    { z: .44, y: .69, w: .268, h: .010 },
    { z: .58, y: .726, w: .265, h: .008 },
    { z: .76, y: .716, w: .226, h: .006 },
    { z: .97, y: .667, w: .15, h: .005 },
  ], 24, .85), carbon);

  // Engine cover sweeps into the coke-bottle rear. Raised airbox sits behind driver.
  add(loft([
    { z: -2.15, y: .52, w: .105, h: .08 }, { z: -1.75, y: .64, w: .19, h: .21 },
    { z: -1.28, y: .75, w: .25, h: .34 }, { z: -.91, y: .83, w: .235, h: .39 },
    { z: -.70, y: .90, w: .175, h: .335 }, { z: -.62, y: .95, w: .115, h: .21 },
  ], 32), paint);
  const fin = panel([[-2.07, .57], [-1.60, 1.00], [-.98, 1.2], [-.91, .89], [-1.51, .51]], .015);
  fin.rotateY(-Math.PI / 2);
  add(fin, paint, chassis, [-.008, 0, 0]);
  const intake = add(new THREE.SphereGeometry(1, 24, 14), black, chassis, [0, 1.125, -.594]); intake.scale.set(.104, .080, .024);
  add(new THREE.TorusGeometry(.091, .017, 8, 32), paint, chassis, [0, 1.125, -.602]).scale.set(1.22, 1, 1);
  rod([0, 1.055, -.56], [0, 1.203, -.56], .006, titanium);
  rod([-.083, 1.12, -.563], [.083, 1.12, -.563], .005, titanium);
  decal('26', .20, .15, [0, .618, frontZ(1.27)], [-Math.PI / 2 - .10, 0, Math.PI]);
  decal('APEX', .135, .34, [0, .458, frontZ(1.88)], [-Math.PI / 2 - .12, 0, Math.PI]);
  decal('APEX', .34, .12, [.246, .805, -1.27], [0, Math.PI / 2, -.15]);

  // The titanium halo includes a low, narrow center pillar and a continuous hoop.
  add(tube([[-.31, .76, -.64], [-.355, 1.13, -.54], [-.315, 1.194, -.10], [-.19, 1.198, .34], [0, 1.185, .53], [.19, 1.198, .34], [.315, 1.194, -.10], [.355, 1.13, -.54], [.31, .76, -.64]], .019, 64, 10), carbon);
  add(tube([[0, .674, .62], [0, .92, .602], [0, 1.185, .53]], .019, 14, 8), carbon);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(.043, 12, 8), titanium, chassis, [s * .31, .77, -.64]);
    rod([s * .25, .70, .39], [s * .62, .805, .37], .015, carbon);
    add(loft([{z:.30,x:s*.646,y:.807,w:.105,h:.045}, {z:.405,x:s*.647,y:.816,w:.114,h:.045}, {z:.443,x:s*.645,y:.814,w:.084,h:.037}], 18), paint);
    const mirrorMaterial = new THREE.MeshBasicMaterial({color: 0x596b72});
    const mirror = add(new THREE.PlaneGeometry(.165, .060), mirrorMaterial, chassis,
      [s * .645, .807, .292], [0, Math.PI, 0]);
    mirror.name = `${s < 0 ? 'left' : 'right'}-rear-view`;
    mirror.userData.side = s;
    mirror.castShadow = mirror.receiveShadow = false;
    mirrors.push(mirror);
  }

  // Front multi-element wing with sculpted, upturned outer elements.
  for (let i = 0; i < 4; i++) {
    const wingMat = i === 0 ? carbon : paint; wingMat.side = THREE.DoubleSide;
    add(wingGeometry(1.91 - i * .035, .225 - i * .023, .018 + i * .004), wingMat, chassis,
      [0, .167 + i * .049, frontZ(2.59 - i * .169)], [-.11 - i * .055, 0, 0]);
  }
  for (const s of [-1, 1]) {
    const ep = panel([[2.02, .18], [2.03, .41], [2.34, .37], [2.75, .21], [2.76, .14]], .016);
    ep.rotateY(-Math.PI / 2); add(ep, paint, chassis, [s * .947, 0, FRONT_EXTENSION]);
    rod([s * .09, .28, frontZ(2.48)], [s * .15, .16, frontZ(2.53)], .016, carbon);
    for (let j = 0; j < 3; j++) rod([s * (.4 + j * .14), .18, frontZ(2.56)], [s * (.4 + j * .14), .31, frontZ(2.15)], .007, titanium);
  }

  // Rear wing: real separation between mainplane, flap, endplates and beam wing.
  add(wingGeometry(1.04, .49, .045), carbon, chassis, [0, 1.04, -2.34], [-.10, 0, 0]);
  const rearFlap = add(wingGeometry(1.04, .245, .018), paint, chassis, [0, 1.185, -2.50], [-.42, 0, 0]);
  for (const s of [-1, 1]) {
    const ep = panel([[-2.65, .70], [-2.65, 1.26], [-2.08, 1.14], [-2.07, .99], [-2.25, .80]], .025);
    ep.rotateY(-Math.PI / 2); add(ep, paint, chassis, [s * .545, 0, 0]);
    rod([s * .14, .43, -1.92], [s * .14, 1.049, -2.26], .027, carbon);
    add(wingGeometry(.44, .19, .012), carbon, chassis, [s * .30, .54, -2.32], [-.30, 0, 0]);
    decal('26', .19, .12, [s * .566, 1.06, -2.39], [0, s * Math.PI / 2, 0]);
  }
  decal('A P E X', .88, .11, [0, 1.191, -2.64], [0, Math.PI, 0]);
  rod([0, .51, -1.98], [0, .52, -2.31], .04, titanium);
  add(new THREE.CylinderGeometry(.032, .032, .004, 16), black, chassis, [0, .52, -2.318], [Math.PI / 2, 0, 0]);
  const rainLight = add(new THREE.BoxGeometry(.075, .075, .032), redLight, chassis, [0, .376, -2.32]);

  // Driver and cockpit. Steering assembly stays visible in the onboard view.
  const driver = new THREE.Group(); chassis.add(driver); hiddenInCockpit.push(driver);
  const helmet = add(new THREE.SphereGeometry(.145, 32, 24), white, driver, [0, .973, -.40]); helmet.scale.set(.88, 1.06, 1.05);
  const visor = add(new THREE.SphereGeometry(.150, 32, 12, 0, Math.PI, .32 * Math.PI, .31 * Math.PI), blue, driver, [0, .979, -.393]);
  visor.scale.set(.91, 1, 1.04);
  add(tube([[-.122, 1.025, -.33], [0, 1.029, -.247], [.122, 1.025, -.33]], .007, 18, 5), paint, driver);
  const suit = add(new THREE.SphereGeometry(1, 18, 12), fabric, driver, [0, .69, -.47]); suit.scale.set(.205, .10, .21);
  add(new THREE.CylinderGeometry(.065, .075, .12, 16), black, driver, [0, .816, -.40]);
  for (const s of [-1, 1]) {
    add(loft([
      {z:-.48,x:s*.16,y:.705,w:.054,h:.052},
      {z:-.32,x:s*.192,y:.694,w:.045,h:.040},
      {z:-.14,x:s*.192,y:.700,w:.043,h:.038},
      {z:-.08,x:s*.173,y:.718,w:.036,h:.036},
      {z:.03,x:s*.16,y:.755,w:.031,h:.031},
      {z:.12,x:s*.14,y:.779,w:.026,h:.027},
      {z:.165,x:s*.127,y:.792,w:.023,h:.026},
    ], 16), fabric);
    rod([s * .14, .754, -.55], [s * .13, .61, -.1], .025, black, driver);
  }
  rod([0, .60, .32], [0, .79, .175], .021, titanium);
  const steering = new THREE.Group(); steering.position.set(0, .802, .18); steering.rotation.x = -.13; chassis.add(steering);
  const wheelFace = panel([[-.149,.031],[-.129,.075],[-.065,.086],[-.04,.065],[.04,.065],[.065,.086],[.129,.075],[.149,.031],[.128,-.078],[.071,-.088],[.055,-.062],[-.055,-.062],[-.071,-.088],[-.128,-.078]], .025);
  add(wheelFace, carbon, steering, [0, 0, -.015]);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(.031, 16, 12), glove, steering, [s * .139, -.004, -.037]).scale.set(.86, 1.15, .85);
    // Four curled fingers wrap the vertical grip; the thumb sits on its inside.
    for (let finger = 0; finger < 4; finger++) {
      const y = .027 - finger * .015;
      add(tube([[s*.144,y,-.011],[s*.15,y,-.037],[s*.135,y,-.060],[s*.117,y,-.033]], .0056, 10, 6), glove, steering);
    }
    add(new THREE.SphereGeometry(.012, 12, 8), glove, steering, [s * .107, .002, -.036]).scale.set(.75, 1.55, 1);
    rod([s*.139,-.017,-.062],[s*.140,.023,-.062],.002,fabric,steering);
    add(tube([[s*.127,.058,-.025],[s*.139,.018,-.027],[s*.126,-.056,-.027]], .021, 12, 8), rubber, steering);
    add(new THREE.BoxGeometry(.032, .078, .011), alloy, steering, [s * .1, -.018, .030]);
  }
  const displayCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let displayTexture, displayContext;
  if (displayCanvas) {
    displayCanvas.width = 512; displayCanvas.height = 288; displayContext = displayCanvas.getContext('2d');
    displayTexture = new THREE.CanvasTexture(displayCanvas); displayTexture.colorSpace = THREE.SRGBColorSpace;
    resources.add(displayTexture); labelTextures.add(displayTexture);
    add(new THREE.PlaneGeometry(.105, .063), new THREE.MeshBasicMaterial({ map: displayTexture, toneMapped: false }), steering, [0, .014, -.035], [0, Math.PI, 0]);
  }
  const ledMaterials = [];
  for (let i = 0; i < 11; i++) {
    const color = i < 4 ? 0x1afa70 : i < 8 ? 0xffbd20 : 0x45a5ff;
    const mat = new THREE.MeshBasicMaterial({ color }); ledMaterials.push(mat);
    add(new THREE.SphereGeometry(.0039, 6, 4), mat, steering, [(i - 5) * .0096, .059, -.032]);
  }
  const buttonColors = [0xffd023, 0xe72c3e, 0x2399ee, 0x67ce88, 0xe9e9e9, 0xff832a];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: buttonColors[i], roughness: .45 });
    add(new THREE.CylinderGeometry(.008, .008, .007, 12), mat, steering,
      [(i < 3 ? -1 : 1) * (.085 + ((i % 3) === 1 ? .016 : 0)), .043 - (i % 3) * .03, -.035], [Math.PI / 2, 0, 0]);
  }
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(.013, .014, .01, 14), yellow, steering, [s * .040, -.044, -.035], [Math.PI / 2, 0, 0]);
    rod([s * .04, -.044, -.042], [s * .04 + .005, -.034, -.042], .002, black, steering);
  }

  const wheelUnits = [];
  const tireSideTexture = width => canvasTexture(512, 512, (c, w) => {
    c.clearRect(0, 0, w, w); c.translate(w / 2, w / 2);
    c.strokeStyle = '#d9b652'; c.lineWidth = 2.6; c.beginPath(); c.arc(0, 0, 190, 0, TAU); c.stroke();
    const text = 'APEX  •  SOFT';
    c.font = 'bold 32px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#e0bb58';
    for (const base of [-Math.PI / 2, Math.PI / 2]) for (let i = 0; i < text.length; i++) {
      const a = base + (i - (text.length - 1) / 2) * .104;
      c.save(); c.rotate(a); c.translate(0, -166); c.fillText(text[i], 0, 0); c.restore();
    }
    c.font = '14px Arial'; c.fillStyle = '#77797b'; c.fillText(`${Math.round(width * 1000)} / 720 — 18`, 0, 122);
  });
  const tireSideMaps = [tireSideTexture(FRONT_TYRE_WIDTH), tireSideTexture(REAR_TYRE_WIDTH)];
  const sideMaterials = tireSideMaps.map(map => {
    if (!map) return rubber;
    resources.add(map); labelTextures.add(map);
    return new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: .93, polygonOffset: true, polygonOffsetFactor: -1 });
  });
  const tireFront = tireGeometry(FRONT_TYRE_WIDTH), tireRear = tireGeometry(REAR_TYRE_WIDTH);
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const width = front ? FRONT_TYRE_WIDTH : REAR_TYRE_WIDTH;
    const z = front ? FRONT_AXLE_Z : REAR_AXLE_Z, x = side * (HALF_TYRE_ENVELOPE - width / 2);
    const steerPivot = new THREE.Group();
    steerPivot.name = `${front ? 'front' : 'rear'}-${side > 0 ? 'right' : 'left'}-wheel`;
    steerPivot.position.set(x, WHEEL_RADIUS, z); group.add(steerPivot);
    const spin = new THREE.Group(); steerPivot.add(spin);
    add(front ? tireFront : tireRear, rubber, spin);
    for (const edge of [-1, 1]) {
      const r = add(new THREE.TorusGeometry(.219, .0096, 8, 40), titanium, spin, [edge * (width / 2 - .010), 0, 0], [0, Math.PI / 2, 0]);
      r.castShadow = false;
      add(new THREE.CylinderGeometry(.203, .203, .014, 48), satin, spin, [edge * (width / 2 - .014), 0, 0], [0, 0, Math.PI / 2]);
      for (let spoke = 0; spoke < 10; spoke++) {
        const a = spoke * TAU / 10;
        rod([edge * (width / 2 - .023), Math.sin(a) * .072, Math.cos(a) * .072],
          [edge * (width / 2 - .019), Math.sin(a + .065) * .19, Math.cos(a + .065) * .19], .009, titanium, spin);
      }
      add(new THREE.CylinderGeometry(.052, .052, .026, 12), titanium, spin, [edge * (width / 2 - .026), 0, 0], [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(.021, .024, .029, 6), side === 1 ? yellow : paint, spin, [edge * (width / 2 - .016), 0, 0], [0, 0, Math.PI / 2]);
      if (tireSideMaps[front ? 0 : 1]) {
        const lettering = add(new THREE.PlaneGeometry(.713, .713), sideMaterials[front ? 0 : 1], spin,
          [edge * (width / 2 + .0008), 0, 0], [0, edge * Math.PI / 2, 0]);
        lettering.userData.visualOnly = true;
      }
    }
    // Fixed brake caliper and carbon rotor visible behind the rim.
    add(new THREE.CylinderGeometry(.151, .151, .019, 40), carbon, steerPivot, [-side * .075, 0, 0], [0, 0, Math.PI / 2]);
    add(new THREE.BoxGeometry(.058, .16, .065), titanium, steerPivot, [-side * .07, .025, -.127]);
    // Upright, upper/lower wishbones and pushrod connect the exposed wheel to tub.
    for (const height of [.25, .43]) {
      const upper = height > .3;
      const anchors = front
        ? [[side * .132, upper ? .383 : .276, z - .42], [side * .096, upper ? .335 : .232, z + .03]]
        : [[side * .18, bodyHeight(height + .055), z - .24], [side * .18, bodyHeight(height + .055), z + .27]];
      for (const anchor of anchors) rod(anchor, [side * .735, height, z], front ? .014 : .020, carbon, suspension);
    }
    rod([side * (front ? .09 : .16), front ? .419 : bodyHeight(.65), z - (front ? .43 : .2)], [side * .728, .24, z], .013, titanium, suspension);
    rod([side * (front ? .10 : .16), front ? .30 : bodyHeight(.37), z - .18], [side * .76, .36, z - .03], .008, titanium, suspension);
    const duct = add(new THREE.SphereGeometry(1, 16, 12), carbon, steerPivot, [-side * .125, .033, .13]); duct.scale.set(.065, .09, .10);
    wheelUnits.push({ pivot: steerPivot, spin, front, side, restY: WHEEL_RADIUS });
  }

  // Tiny panel fasteners catch glancing light, especially in the cockpit.
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    add(new THREE.SphereGeometry(.0045, 6, 4), alloy, chassis, [s * .285, .73, .10 - i * .13]);
  }
  // Combine stationary pieces per material: detail is geometry, not draw calls.
  // Wheels/steering/DRS retain their independent animated transforms.
  function consolidate(parent, exclude = []) {
    const batches = new Map();
    for (const mesh of [...parent.children]) {
      if (!mesh.isMesh || exclude.includes(mesh)) continue;
      mesh.updateMatrix();
      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrix);
      const visualOnly = Boolean(mesh.userData.visualOnly);
      const key = `${mesh.material.uuid}:${visualOnly}`;
      if (!batches.has(key)) batches.set(key, { geometries: [], material: mesh.material, visualOnly });
      batches.get(key).geometries.push(geo); parent.remove(mesh);
    }
    for (const { geometries, material, visualOnly } of batches.values()) {
      const merged = mergeGeometries(geometries, false);
      if (merged) add(merged, material, parent).userData.visualOnly = visualOnly;
      geometries.forEach(g => g.dispose());
    }
  }
  consolidate(chassis, [rearFlap, rainLight, ...mirrors]);
  consolidate(suspension);
  consolidate(driver); consolidate(steering);
  wheelUnits.forEach(w => { consolidate(w.spin); consolidate(w.pivot); });
  const contactMap = canvasTexture(128, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.save(); c.scale(w, h);
    const g = c.createRadialGradient(.5, .5, .06, .5, .5, .5);
    g.addColorStop(0, 'rgba(0,0,0,.72)'); g.addColorStop(.53, 'rgba(0,0,0,.50)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 1, 1); c.restore();
  });
  if (contactMap) {
    resources.add(contactMap);
    const m = new THREE.MeshBasicMaterial({ map: contactMap, transparent: true, depthWrite: false, opacity: .43, toneMapped: false });
    const shadow = add(new THREE.PlaneGeometry(2.45, 5.0), m, group, [0, .008, -.12], [-Math.PI / 2, 0, 0]);
    shadow.castShadow = false; shadow.receiveShadow = false;
    shadow.userData.visualOnly = true;
  }
  function setMirrored(enabled) {
    labelTextures.forEach(t => { t.repeat.x = enabled ? -1 : 1; t.offset.x = enabled ? 1 : 0; t.needsUpdate = true; });
  }
  setMirrored(mirrored);
  if (ghost) {
    resources.forEach(r => {
      if (r.isMaterial) { r.transparent = true; r.opacity = .34; r.depthWrite = false; }
    });
  }

  let elapsed = 0, wheelAngle = 0, displayTick = -1, lastDisplay = '';
  function update(state = {}, dt = 1 / 60) {
    dt = clamp(dt, 0, .1); elapsed += dt;
    const speed = Number(state.forwardSpeed ?? state.speed ?? state.velocity?.length?.() ?? 0) || 0;
    const steer = clamp(Number(state.steering ?? state.steer ?? state.inputs?.steering ?? 0) || 0, -1, 1);
    const rpm = clamp(Number(state.rpm ?? 5500 + Math.abs(speed) * 70) || 0, 0, 16000);
    const throttle = clamp(Number(state.throttle ?? state.inputs?.throttle ?? 0) || 0, 0, 1);
    const brake = clamp(Number(state.brake ?? state.inputs?.brake ?? 0) || 0, 0, 1);
    const vibration = (state.onKerb || state.onCurb || state.kerb || state.surface === 'kerb') ? .006 : .0008;
    const ride = Number.isFinite(state.rideHeight) ? state.rideHeight - .057 : 0;
    const movingVibration = vibration * Math.min(Math.abs(speed) / 18, 1);
    chassis.position.y = BODY_Y_OFFSET + ride + Math.sin(elapsed * 87) * movingVibration + (state.suspensionTravel || 0) * .3;
    chassis.rotation.z = THREE.MathUtils.damp(chassis.rotation.z, clamp(state.gForce?.x ?? steer, -4, 4) * .003, 9, dt);
    chassis.rotation.x = THREE.MathUtils.damp(chassis.rotation.x, clamp(state.gForce?.y ?? throttle - brake, -4, 4) * -.002, 8, dt);
    steering.rotation.z = -steer * .95;
    wheelAngle = state.wheelRotation ?? ((wheelAngle + speed * dt / WHEEL_RADIUS) % TAU);
    for (const w of wheelUnits) {
      w.spin.rotation.x = wheelAngle;
      if (w.front) w.pivot.rotation.y = (state.steeringAngle ?? steer * .34) * (1 + steer * w.side * .055);
      w.pivot.position.y = w.restY + Math.sin(elapsed * 75 + w.side + (w.front ? 0 : 2.1)) * movingVibration * .32;
    }
    rearFlap.rotation.x = THREE.MathUtils.damp(rearFlap.rotation.x, state.drs ? -.02 : -.42, 8, dt);
    rainLight.material.emissiveIntensity = (state.pitLimiter || state.ersHarvest || brake > .08) && Math.sin(elapsed * 15) > 0 ? 4 : .8;
    if (displayContext && Math.floor(elapsed * 12) !== displayTick) {
      displayTick = Math.floor(elapsed * 12);
      const gear = state.gear ?? 'N', kph = Math.round(Math.abs(speed) * 3.6);
      const signature = `${gear}-${kph}-${Math.round(rpm / 100)}-${Math.round(throttle * 10)}`;
      if (signature !== lastDisplay) {
        lastDisplay = signature;
        const c = displayContext; c.fillStyle = '#030a0c'; c.fillRect(0, 0, 512, 288);
        c.fillStyle = '#83ddd6'; c.font = 'bold 26px monospace'; c.textAlign = 'left'; c.fillText('RACE', 18, 35);
        c.fillStyle = '#f4f5eb'; c.textAlign = 'center'; c.font = 'bold 159px monospace'; c.fillText(String(gear), 256, 190);
        c.font = 'bold 32px monospace'; c.textAlign = 'right'; c.fillText(String(kph), 487, 77);
        c.font = '18px monospace'; c.fillStyle = '#8d9ea1'; c.fillText('KM/H', 487, 102);
        c.textAlign = 'left'; c.fillStyle = '#d6e8df'; c.font = '24px monospace'; c.fillText(String(Math.round(rpm)), 19, 82);
        c.fillStyle = '#83ddd6'; c.fillRect(18, 237, 476 * clamp((rpm - 4500) / 9000, 0, 1), 9);
        c.fillStyle = '#aebcbc'; c.font = '21px monospace'; c.textAlign = 'center'; c.fillText('APEX · AP 25', 256, 278);
        displayTexture.needsUpdate = true;
      }
      for (let i = 0; i < ledMaterials.length; i++) {
        const lit = (rpm - 7500) / 430 > i;
        ledMaterials[i].color.setHex(lit ? (i < 4 ? 0x1afa70 : i < 8 ? 0xffbd20 : 0x45a5ff) : 0x192528);
      }
    }
  }
  update({}, 0);
  // Measure authored physical geometry, excluding floating text and contact AO.
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), box = new THREE.Box3();
  group.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.visualOnly) return;
    mesh.geometry.computeBoundingBox();
    bounds.union(box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
  });
  const size = bounds.getSize(new THREE.Vector3());
  return {
    group, update, mirrors,
    cockpit: { position: new THREE.Vector3(0, bodyHeight(1.015), -.40), target: new THREE.Vector3(0, .79, 7) },
    nose: { position: new THREE.Vector3(0, .38, frontZ(2.69)), target: new THREE.Vector3(0, .44, 35) },
    setCockpit(enabled) { hiddenInCockpit.forEach(o => { o.visible = !enabled; }); },
    setColor(value) { paint.color.set(value).multiplyScalar(.80); },
    setMirrored,
    dispose() { resources.forEach(r => r.dispose?.()); },
    dimensions: { length: size.z, width: size.x, height: size.y, wheelbase: WHEELBASE,
      frontAxle: FRONT_AXLE_Z, rearAxle: REAR_AXLE_Z, wheelRadius: WHEEL_RADIUS,
      frontTyreWidth: FRONT_TYRE_WIDTH, rearTyreWidth: REAR_TYRE_WIDTH,
      frontTrack: 2 * HALF_TYRE_ENVELOPE - FRONT_TYRE_WIDTH, rearTrack: 2 * HALF_TYRE_ENVELOPE - REAR_TYRE_WIDTH,
      frontOverhang: bounds.max.z - FRONT_AXLE_Z, rearOverhang: REAR_AXLE_Z - bounds.min.z,
      min: bounds.min.clone(), max: bounds.max.clone() },
  };
}
