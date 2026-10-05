import * as THREE from 'three';
import {publicAsset} from './assets.js';
import {createStartGantry} from './start-lights.js';
import {createTrackDetails} from './track-details.js';
import {createMonzaLandmarks} from './monza-landmarks.js';
import {createPitComplex} from './pit-complex.js';

// The road follows a geographic centerline and the pit-area structures use
// mapped footprints/points. Heights, facades and vegetation are authored;
// detailed provenance lives in TRACK.md.
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
function rng(seed = 1922) {
  let state = seed >>> 0;
  return () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296;};
}
function canvasTexture(width, height, paint, color = true) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
function setRepeat(texture, x = 1, y = 1) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(x, y);
  texture.anisotropy = 8; return texture;
}
function noiseTexture(type, seed = 19) {
  const random = rng(seed);
  return setRepeat(canvasTexture(512, 512, (ctx, w, h) => {
    const data = ctx.createImageData(w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      const light = random() * 28 + Math.sin(i / 367) * 5;
      const base = type === 'gravel' ? [156, 143, 119] : type === 'grass' ? [81, 86, 58] : [49, 50, 51];
      data.data[i] = base[0] + light; data.data[i + 1] = base[1] + light;
      data.data[i + 2] = base[2] + light; data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    if (type === 'gravel') for (let n = 0; n < 7500; n++) {
      const r = 1 + random() * 3, x = random() * w, y = random() * h;
      ctx.fillStyle = `rgba(60,51,40,${.1 + random() * .2})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * .65, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(238,231,213,.18)'; ctx.fillRect(x, y - 1, r, 1);
    }
  }));
}

function ribbon(track, start, end, left, right, y = 0, step = 3, scale = 3, colorAt) {
  const count = Math.max(1, Math.ceil((end - start) / step));
  const positions = [], uvs = [], indices = [], colors = [];
  const color = new THREE.Color();
  for (let i = 0; i <= count; i++) {
    const distance = THREE.MathUtils.lerp(start, end, i / count), s = track.sample(distance);
    const edgeA = typeof left === 'function' ? left(s, distance) : left;
    const edgeB = typeof right === 'function' ? right(s, distance) : right;
    const a = Math.min(edgeA, edgeB), b = Math.max(edgeA, edgeB);
    for (const lateral of [a, b]) {
      const p = s.position.clone().addScaledVector(s.right, lateral);
      positions.push(p.x, s.position.y + y, p.z); uvs.push(lateral / scale, distance / scale);
      if (colorAt) {color.set(colorAt(distance, lateral)); colors.push(color.r, color.g, color.b);}
    }
    if (i < count) {const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);}
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function treeTexture(seed, hue = 0) {
  const random = rng(seed);
  return canvasTexture(768, 1024, (ctx, w, h) => {
    // Recursive tapering branches plus individually shaded leaflets avoid the
    // uniform, circular silhouettes of primitive foliage geometry.
    const endpoints = [], branches = [];
    function branch(x, y, length, angle, width, depth) {
      const nx = x + Math.sin(angle) * length, ny = y - Math.cos(angle) * length;
      const shade = Math.floor(49 + random() * 22);
      branches.push({x, y, nx, ny, width, shade});
      if (depth < 1) {endpoints.push([nx, ny, 38 + random() * 40]); return;}
      for (let k = 0; k < 3; k++) branch(nx, ny, length * (.55 + random() * .12),
        angle + (k - 1) * (.38 + random() * .3), width * .54, depth - 1);
    }
    branch(w * .5, h, 275, 0, 34, 4);
    branch(w * .5, h * .81, 240, -.44, 21, 4);
    branch(w * .5, h * .78, 265, .38, 23, 4);
    // Fit the complete tree into its alpha card. Cutting a wide random crown
    // at the canvas boundary gives trees conspicuous rectangular silhouettes.
    const minX = Math.min(...endpoints.map(([x, , r]) => x - r)) - 7;
    const maxX = Math.max(...endpoints.map(([x, , r]) => x + r)) + 7;
    const minY = Math.min(...endpoints.map(([, y, r]) => y - r * .75)) - 7;
    const sx = (w - 44) / (maxX - minX), sy = (h - 20) / (h - minY);
    ctx.setTransform(sx, 0, 0, sy, 22 - minX * sx, 20 - minY * sy);
    for (const b of branches) {
      ctx.strokeStyle = `rgb(${b.shade + 9},${b.shade + 3},${b.shade - 7})`;
      ctx.lineWidth = b.width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.nx, b.ny); ctx.stroke();
    }
    // Rear foliage then lit clusters; asymmetric crown with holes at its edges.
    endpoints.sort((a, b) => b[1] - a[1]);
    endpoints.forEach(([x, y, radius], index) => {
      const lighting = .5 + .5 * (1 - x / w);
      for (let n = 0; n < 115; n++) {
        const angle = random() * Math.PI * 2, r = Math.sqrt(random()) * radius;
        const lx = x + Math.cos(angle) * r, ly = y + Math.sin(angle) * r * .72;
        const bright = random() * 36 + lighting * 28;
        const warm = hue + random() * 7;
        ctx.fillStyle = `rgb(${29 + bright + warm},${39 + bright},${21 + bright * .38})`;
        ctx.beginPath(); ctx.ellipse(lx, ly, 2 + random() * 4, 1.5 + random() * 2.5, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
      }
    });
  });
}

export async function createWorld(scene, track, {quality = 'high'} = {}) {
  const lowQuality = quality === 'low' || quality === 'performance';
  const root = new THREE.Group(); root.name = 'Monza • Parco Reale'; scene.add(root);
  const random = rng(57931922), textures = [], materials = [], dynamic = [], sceneryClearances = [];
  const loader = new THREE.TextureLoader();
  async function loadTexture(path, color, fallback) {
    try {
      const t = await loader.loadAsync(publicAsset(path));
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      setRepeat(t); textures.push(t); return t;
    } catch {const t = fallback?.(); if (t) textures.push(t); return t;}
  }
  const [asphaltMap, asphaltNormal, asphaltRough, grassMap, grassNormal, spectatorAtlas, bridgeReference, landmarkReference] = await Promise.all([
    loadTexture('/textures/race-asphalt-clean-v1-diffuse.jpg', true, () => noiseTexture('asphalt')),
    loadTexture('/textures/race-asphalt-clean-v1-normal.jpg', false),
    loadTexture('/textures/race-asphalt-clean-v1-roughness.jpg', false),
    loadTexture('/textures/grass-diffuse.jpg', true, () => noiseTexture('grass')),
    loadTexture('/textures/grass-normal.jpg', false),
    loadTexture('/textures/spectators-atlas-v1.png', true),
    fetch(publicAsset('data/monza-banking-bridge.json')).then(response => response.ok ? response.json() : null).catch(() => null),
    fetch(publicAsset('data/monza-landmarks.json')).then(response => {
      if(!response.ok)throw new Error('Unable to load the Monza building footprints.');
      return response.json();
    }),
  ]);
  const material = (options) => {const m = new THREE.MeshStandardMaterial(options); materials.push(m); return m;};
  const asphalt = material({map: asphaltMap, normalMap: asphaltNormal, normalScale: new THREE.Vector2(.28, .28),
    roughnessMap: asphaltRough, roughness: .98, color: 0xa6a8ac, metalness: 0});
  const roadRoughnessFloor = {value: .91};
  asphalt.onBeforeCompile = shader => {
    shader.uniforms.roadRoughnessFloor = roadRoughnessFloor;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float roadRoughnessFloor;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, roadRoughnessFloor);');
  };
  const grass = material({map: grassMap, normalMap: grassNormal, normalScale: new THREE.Vector2(.75, .75),
    color: 0xa5b095, roughness: 1});
  const gravelMap = noiseTexture('gravel'); textures.push(gravelMap);
  const gravel = material({map: gravelMap, roughness: 1, color: 0xd1c3a6});
  const white = material({color: 0xedece5, roughness: .9});
  const red = material({color: 0xb0201d, roughness: .65});
  const green = material({color: 0x236c51, roughness: .94});
  const metal = material({color: 0xa3a8a7, metalness: .62, roughness: .42});
  const darkMetal = material({color: 0x333b3e, metalness: .65, roughness: .44});
  const concrete = material({color: 0xc5bfb0, roughness: .94});
  const concreteDark = material({color: 0x777b76, roughness: .91});
  const glass = material({color: 0x455d64, metalness: .65, roughness: .15});
  const rubber = material({color: 0x191c1b, roughness: .96});
  const kerb = material({vertexColors: true, roughness: .9});
  const blue = material({color: 0x658796, roughness: .8});
  const ochre = material({color: 0xb7a576, roughness: .85});

  function mesh(geometry, mat, receive = true, cast = false) {
    const m = new THREE.Mesh(geometry, mat); m.receiveShadow = receive; m.castShadow = cast;
    root.add(m); return m;
  }
  const batches = new Map(), boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const boxMaterials = new Map();
  const neutralInstanceColor = new THREE.Color(0xffffff);
  const dummy = new THREE.Object3D();
  const INSTANCE_CELL_SIZE = 300;
  const spatialBatchStats = {cellSize: INSTANCE_CELL_SIZE, batches: 0, instances: 0};
  function spatialBuckets(items, getPosition) {
    const cells = new Map();
    for (const item of items) {
      const [x, z] = getPosition(item);
      const key = `${Math.floor(x / INSTANCE_CELL_SIZE)},${Math.floor(z / INSTANCE_CELL_SIZE)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(item);
    }
    return cells;
  }
  function finishInstances(instances, {cast = false, receive = true, name = ''} = {}) {
    instances.castShadow = cast; instances.receiveShadow = receive; instances.name = name;
    // Bounds must describe this cell, not the entire 5.8 km circuit. Both the
    // main view and the moving sun's shadow camera can then reject whole cells.
    instances.computeBoundingBox();
    instances.boundingSphere = instances.boundingBox.getBoundingSphere(new THREE.Sphere());
    instances.matrixAutoUpdate = false;
    instances.updateMatrix();
    spatialBatchStats.batches++; spatialBatchStats.instances += instances.count;
    root.add(instances);
    return instances;
  }
  function matrixChunks(geometry, mat, matrices, options = {}, forceChunks = false) {
    const cells = forceChunks || matrices.length >= 256
      ? spatialBuckets(matrices, m => [m.elements[12], m.elements[14]])
      : new Map([['local', matrices]]);
    for (const [cell, transforms] of cells) {
      const instances = new THREE.InstancedMesh(geometry, mat, transforms.length);
      transforms.forEach((matrix, i) => instances.setMatrixAt(i, matrix));
      finishInstances(instances, {...options, name: `${options.name || 'Scenery'} · ${cell}`});
    }
  }
  function boxMaterialGroup(source) {
    // Keep genuinely different responses separate while moving each paint
    // color into instanceColor. Glass must retain its sharp reflections, and
    // metallic barriers must retain their metallic response.
    const compatible = !source.transparent && source.opacity === 1 && !source.alphaTest
      && !source.map && !source.normalMap && !source.roughnessMap && !source.metalnessMap
      && !source.emissiveMap && !source.alphaMap && !source.vertexColors
      && source.emissive.getHex() === 0;
    if (!compatible) return {key: source.uuid, mat: source, color: neutralInstanceColor};
    const response = source.roughness <= .25 && source.metalness > .4 ? 'glass'
      : source.metalness > .4 ? 'metal' : source.roughness < .82 ? 'paint' : 'matte';
    if (!boxMaterials.has(response)) {
      const parameters = {
        matte: {roughness: .94, metalness: 0},
        paint: {roughness: .68, metalness: 0},
        metal: {roughness: .43, metalness: .64},
        glass: {roughness: .15, metalness: .65},
      }[response];
      boxMaterials.set(response, material({color: 0xffffff, ...parameters}));
    }
    return {key: response, mat: boxMaterials.get(response), color: source.color};
  }
  function box(mat, position, dimensions, heading = 0, cast = true) {
    const group = boxMaterialGroup(mat);
    const key = `${group.key}:${cast}`;
    if (!batches.has(key)) batches.set(key, {mat: group.mat, entries: [], cast, response: group.key});
    dummy.position.copy(position); dummy.scale.set(...dimensions); dummy.rotation.set(0, heading, 0); dummy.updateMatrix();
    batches.get(key).entries.push({matrix: dummy.matrix.clone(), color: group.color});
  }
  function pointAt(distance, lateral = 0, height = 0) {
    const s = track.sample(distance);
    return s.position.clone().addScaledVector(s.right, lateral).addScaledVector(UP, height);
  }
  function boxAt(distance, lateral, height, dimensions, mat, extraHeading = 0, cast = true) {
    box(mat, pointAt(distance, lateral, height), dimensions, track.sample(distance).heading + extraHeading, cast);
  }
  // Clean Asphalt is a 2.1 m scan; retain that physical scale on the road/pits.
  function roadMesh(start, end, left, right, height, mat, step = 3, uvScale = mat === asphalt ? 2.1 : 3, colorAt) {
    return mesh(ribbon(track, start, end, left, right, height, step, uvScale, colorAt), mat);
  }

  // The ground uses real photographic microtexture and large-scale tonal
  // variation. World-space noise prevents a conspicuous tiled grass pattern.
  grass.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundWorld = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float groundVariation = sin(vGroundWorld.x*.023 + sin(vGroundWorld.z*.032)*1.8)*sin(vGroundWorld.z*.017);
        float mowing = .97 + .03*sin(vGroundWorld.x*.25 + vGroundWorld.z*.035);
        diffuseColor.rgb *= (0.9 + groundVariation*.11)*mowing;`);
  };
  const terrainGeometry = new THREE.PlaneGeometry(4600, 4600);
  terrainGeometry.rotateX(-Math.PI / 2);
  const terrainUV = terrainGeometry.attributes.uv;
  for (let i = 0; i < terrainUV.count; i++) terrainUV.setXY(i, terrainUV.getX(i) * 4600 / 15, terrainUV.getY(i) * 4600 / 15);
  const terrain = mesh(terrainGeometry, grass); terrain.position.set(500, -.07, 300);
  const bands = track.surfaceBands;
  roadMesh(0, track.length, -bands.apron.outer, bands.apron.outer, -.005, asphalt, 2.5);
  roadMesh(0, track.length, -track.width / 2, track.width / 2, .012, asphalt, 2);
  for (const side of [-1, 1]) {
    roadMesh(0, track.length, side * 5.78, side * 5.99, .024, white, 3);
    // A ragged earthy shoulder anchors the smooth asphalt in the landscape.
    roadMesh(0, track.length, side * bands.shoulder.inner, side * bands.shoulder.outer, -.001, gravel, 3, 2);
  }

  // Broader gravel traps sit on the outside of the real turn locations.
  track.runoffSections.forEach(([start, end, side]) => {
    const outer = s => side * ((side < 0 ? s.barrierLeft : s.barrierRight) - bands.gravelTrap.barrierClearance);
    const a = side < 0 ? outer : bands.gravelTrap.inner, b = side < 0 ? -bands.gravelTrap.inner : outer;
    roadMesh(start, end, a, b, -.015, gravel, 2.5, 2);
    roadMesh(start, end, side * bands.runoffPaint.inner, side * bands.runoffPaint.outer, .003, green, 3);
  });

  const tyreMarks = canvasTexture(128, 512, (ctx, w, h) => {
    const r = rng(57);
    for (let n = 0; n < 9000; n++) {
      ctx.fillStyle = `rgba(8,10,11,${r() * .2})`;
      ctx.fillRect(r() * w, r() * h, .4 + r() * 2, 1 + r() * 8);
    }
  }); setRepeat(tyreMarks); textures.push(tyreMarks);
  const tyreMaterial = material({map: tyreMarks, color: 0x4b4b48, transparent: true, opacity: .28,
    depthWrite: false, roughness: .96, polygonOffset: true, polygonOffsetFactor: -1});
  for (const corner of track.corners.filter(c => [1, 4, 6, 7, 8, 11].includes(c.number))) {
    for (const lane of [-2.7, -1.1, 1.2]) roadMesh(corner.distance - 200, corner.distance - 15,
      lane - .19, lane + .19, .027, tyreMaterial, 2, 1);
  }
  // Subtle rubber laid down along a continuous line gives the road real scale.
  roadMesh(0, track.length, -.8, .8, .026, tyreMaterial, 4, 3);

  // Guardrails, concrete pit wall, mesh fencing, regular support posts.
  const fenceTexture = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(109,115,109,.72)'; ctx.lineWidth = 1.25;
    for (let x = -128; x < 256; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 128, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 128, 128); ctx.stroke();
    }
  }); setRepeat(fenceTexture); textures.push(fenceTexture);
  const fenceMaterial = material({map: fenceTexture, transparent: true, alphaTest: .08, opacity: .65,
    side: THREE.DoubleSide, depthWrite: false, roughness: .66, metalness: .25});
  for (const side of [-1, 1]) {
    const fencePositions = [], fenceUV = [], fenceIndices = [];
    const count = Math.ceil(track.length / 5);
    let previous = null;
    for (let i = 0; i <= count; i++) {
      const d = i * track.length / count, s = track.sample(d);
      const lateral = side * (side < 0 ? s.barrierLeft : s.barrierRight);
      const p = s.position.clone().addScaledVector(s.right, lateral);
      const isPit = side > 0 && (d < 280 || d > track.length - 460);
      if (previous) {
        const middle = previous.clone().lerp(p, .5), delta = p.clone().sub(previous);
        const heading = Math.atan2(delta.x, delta.z), len = delta.length() + .12;
        if (isPit) box(concrete, middle.clone().addScaledVector(UP, .63), [.45, 1.26, len], heading);
        else for (const height of [.38, .67, .96]) box(metal, middle.clone().addScaledVector(UP, height), [.15, .23, len], heading, false);
      }
      if (i % 2 === 0) box(darkMetal, p.clone().addScaledVector(UP, 1.65), [.095, 3.3, .1], s.heading, false);
      const fencePoint = p.clone().addScaledVector(s.right, side * .28);
      fencePositions.push(fencePoint.x, 1.05, fencePoint.z, fencePoint.x, 3.45, fencePoint.z);
      fenceUV.push(d / 2, 0, d / 2, 1.2);
      if (i < count) {const k = i * 2; fenceIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);}
      previous = p;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fencePositions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(fenceUV, 2)); g.setIndex(fenceIndices); g.computeVertexNormals();
    mesh(g, fenceMaterial, false, false);
  }

  // Track signs use high-resolution canvas lettering instead of DOM labels.
  function signTexture(text, bg = '#f2f0e7', fg = '#182226', sub = '', width = 1024, height = 256) {
    const texture = canvasTexture(width, height, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 ${h * (sub ? .43 : .57)}px Arial, sans-serif`; ctx.fillText(text, w / 2, h * (sub ? .40 : .53), w * .91);
      if (sub) {ctx.font = `600 ${h * .14}px Arial, sans-serif`; ctx.fillText(sub, w / 2, h * .80, w * .90);}
    });
    // Simulation uses north +Z; rendering reflects Z for a geographically
    // correct driver's view. Keep lettering readable through that reflection.
    texture.repeat.x = -1; texture.offset.x = 1;
    textures.push(texture); return texture;
  }
  function board(distance, lateral, height, width, depth, text, options = {}) {
    const t = signTexture(text, options.bg, options.fg, options.sub || '', options.resolution || 1024, 256);
    const mat = material({map: t, roughness: .78, side: THREE.DoubleSide});
    const b = mesh(new THREE.PlaneGeometry(width, depth), mat, true, false);
    b.position.copy(pointAt(distance, lateral, height));
    b.rotation.y = track.sample(distance).heading + Math.PI + (options.sideways ? Math.PI / 2 : 0);
    return b;
  }

  const construction={track,root,material,mesh,box,boxAt,pointAt,board,roadMesh,textures,materials,sceneryClearances};
  const trackDetails=createTrackDetails(construction);

  // The separate garage, hospitality and podium footprints come from OSM;
  // facade/height detail follows inspected panoramas and official photographs.
  roadMesh(track.length - 440, track.length + 270, 10.0, 23.0, .009, asphalt, 2);
  roadMesh(track.length - 335, track.length + 40, 21.5, 53, .010, asphalt, 2);
  roadMesh(track.length - 440, track.length + 270, 20.6, 20.8, .021, white, 2);
  roadMesh(track.length - 440, track.length + 270, 11.2, 11.4, .021, white, 2);
  const pitComplex=createPitComplex(construction,landmarkReference);
  const landmarks=createMonzaLandmarks(construction,landmarkReference);

  // The grid/start gantry and control line are separate at Monza. Geography
  // remains referenced to the grid; the finish is 309 m behind it.
  const startSignal=createStartGantry(construction);
  for (let i = 0; i < 16; i++) for (let row = 0; row < 2; row++) {
    boxAt(track.controlLineDistance - .25 + row * .38, -5.63 + i * .75, .033, [.75, .014, .38], (i + row) % 2 ? white : rubber, 0, false);
  }
  boxAt(track.startLineDistance, 0, .033, [12, .014, .25], white, 0, false);
  for (let i = 0; i < 24; i++) {
    const d = -15 - i * 8, lateral = i % 2 ? -2.55 : 2.55;
    boxAt(d, lateral, .033, [2.2, .016, .12], white, 0, false);
    for (const side of [-1, 1]) boxAt(d - 2.1, lateral + side * 1.1, .032, [.12, .015, 4.2], white, 0, false);
  }

  // Grandstands use stepped seating, overhead roofs, thin steel columns, and
  // instanced spectators. The central tribune faces the start and pit complex.
  const seat = material({color: 0x723d33, roughness: .95});
  const crowdColors = [0x6b3b32, 0x384753, 0x747a72, 0x9c9583, 0xb5b5a4, 0x303937, 0x565249]
    .map(color => new THREE.Color(color));
  const skinColors = [0x9c795c, 0xb59470, 0x675142].map(color => new THREE.Color(color));
  const crowdMaterial = material({color: 0xffffff, roughness: 1});
  const crowdGeometry = new THREE.CapsuleGeometry(.5, 1, 1, 5); crowdGeometry.scale(1, .5, 1);
  const headGeometry = new THREE.SphereGeometry(.5, 5, 3);
  let photographicCrowdMaterial = null;
  if (spectatorAtlas) {
    spectatorAtlas.wrapS = spectatorAtlas.wrapT = THREE.ClampToEdgeWrapping;
    spectatorAtlas.anisotropy = 4;
    photographicCrowdMaterial = material({map: spectatorAtlas, color: 0xffffff,
      roughness: 1, alphaTest: .38, alphaToCoverage: true, side: THREE.DoubleSide});
    photographicCrowdMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 crowdAtlasUV;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv = crowdAtlasUV.xy + vMapUv * crowdAtlasUV.zw;
          #endif`);
    };
    photographicCrowdMaterial.customProgramCacheKey = () => 'monza-spectator-atlas-v1';
  }
  const crowdCardGeometry = new THREE.PlaneGeometry(1, 1); crowdCardGeometry.translate(0, .5, 0);
  const crowdTints = [0xf0efe6, 0xe5e8df, 0xe7e4dd, 0xf4f0e6].map(color => new THREE.Color(color));
  const crowdBatches = new Map();
  function spectatorPart(geometry, color, position, scale, heading) {
    const key = geometry.uuid;
    if (!crowdBatches.has(key)) crowdBatches.set(key, {geometry, transforms: []});
    dummy.position.copy(position); dummy.scale.set(...scale); dummy.rotation.set(0, heading, 0); dummy.updateMatrix();
    crowdBatches.get(key).transforms.push({matrix: dummy.matrix.clone(), color});
  }
  function grandstand(distance, side, length = 105, rows = 11, roof = true, offset = 30) {
    crowdBatches.clear();
    const photographicSpectators = [];
    const center = pointAt(distance, side * offset, 0);
    const heading = track.sample(distance).heading;
    sceneryClearances.push({center, heading, width: rows + 7, length: length + 10});
    const orient = new THREE.Quaternion().setFromAxisAngle(UP, heading);
    function local(x, y, z) {return new THREE.Vector3(x, y, z).applyQuaternion(orient).add(center);}
    box(concreteDark, local(0, .45, 0), [rows * .92 + 2, .9, length], heading);
    for (let row = 0; row < rows; row++) {
      const x = side * (-rows * .46 + row * .92), y = .9 + row * .47;
      box(concrete, local(x, y, 0), [1, .3, length], heading, false);
      box(seat, local(x, y + .36, 0), [.43, .15, length - .8], heading, false);
      for (let z = -length / 2 + 1; z < length / 2; z += 1.3) {
        if (random() < .25 || Math.abs(z % 17) < 1.1) continue;
        // Reuse the same four random values on both paths. Choosing the photo
        // atlas does not reshuffle trees or other scenery later in the build.
        const variety = random();
        const m = crowdColors[Math.floor(variety * crowdColors.length)];
        const sway = (random() - .5) * .08;
        const height = .48 + random() * .09;
        const skinVariety = random();
        if (photographicCrowdMaterial) {
          // The atlas depicts seated head-to-knee figures. Put its knee crop
          // at bench level and its head near 1.3 m above the row's floor.
          const cardHeight = 1.11 + (height - .48) * 1.6;
          dummy.position.copy(local(x - side * .2, y + .23, z + sway));
          dummy.rotation.set(0, heading - side * Math.PI / 2 + sway * 2, 0);
          dummy.scale.set(cardHeight * .75, cardHeight, 1); dummy.updateMatrix();
          const tile = Math.floor(variety * 8), column = tile % 4, rowIndex = Math.floor(tile / 4);
          // TextureLoader's flipped image coordinates put the top atlas row
          // in v=.5..1. Four-pixel insets reduce neighboring-cell mip bleed.
          const insetU = 4 / 1536, insetV = 4 / 1024;
          const scaleU = .25 - insetU * 2, scaleV = .5 - insetV * 2;
          const flip = skinVariety < .5;
          photographicSpectators.push({matrix: dummy.matrix.clone(),
            uv: [column * .25 + insetU + (flip ? scaleU : 0), (1 - rowIndex) * .5 + insetV,
              flip ? -scaleU : scaleU, scaleV],
            tint: crowdTints[Math.floor(skinVariety * crowdTints.length)], tile});
        } else {
          spectatorPart(crowdGeometry, m, local(x, y + .71, z), [.27, height, .36], heading);
          spectatorPart(headGeometry, skinColors[Math.floor(skinVariety * skinColors.length)], local(x + sway, y + 1.1, z), [.23, .265, .22], heading);
          for (const armSide of [-1, 1]) spectatorPart(crowdGeometry, m,
            local(x - side * .04, y + .69, z + armSide * .21), [.105, .41, .1], heading);
        }
      }
    }
    const back = side * (rows * .5 + .6), top = rows * .47 + 2;
    for (let z = -length / 2; z <= length / 2 + .1; z += 15) {
      box(metal, local(back, top / 2, z), [.25, top, .25], heading);
      if (roof) box(darkMetal, local(0, top + .9, z), [rows + 2.5, .14, .18], heading);
    }
    if (roof) {
      box(concreteDark, local(side * .3, top + 1.1, 0), [rows + 3.5, .35, length + 2], heading);
      box(white, local(-side * (rows * .5 + 1.1), top + .8, 0), [.22, .7, length + 2], heading);
    }
    box(metal, local(-side * (rows * .5 + .5), 1.8, 0), [.08, .12, length], heading, false);
    if (photographicCrowdMaterial) {
      // One opaque alpha-tested draw for all eight portraits in this stand.
      // Only the tiny tile-coordinate buffer differs between stand geometries.
      const geometry = crowdCardGeometry.clone();
      const atlasCoordinates = new Float32Array(photographicSpectators.length * 4);
      const crowd = new THREE.InstancedMesh(geometry, photographicCrowdMaterial, photographicSpectators.length);
      photographicSpectators.forEach(({matrix, uv, tint}, i) => {
        crowd.setMatrixAt(i, matrix); crowd.setColorAt(i, tint); atlasCoordinates.set(uv, i * 4);
      });
      geometry.setAttribute('crowdAtlasUV', new THREE.InstancedBufferAttribute(atlasCoordinates, 4));
      crowd.userData.atlasColumns = 4; crowd.userData.atlasRows = 2;
      finishInstances(crowd, {name: `Spectators · ${Math.round(distance)} · atlas`});
    } else {
      // Asset failure fallback: two instanced geometric batches per stand.
      for (const {geometry, transforms} of crowdBatches.values()) {
        const crowd = new THREE.InstancedMesh(geometry, crowdMaterial, transforms.length);
        transforms.forEach(({matrix, color}, i) => {crowd.setMatrixAt(i, matrix); crowd.setColorAt(i, color);});
        finishInstances(crowd, {name: `Spectators · ${Math.round(distance)} · ${geometry === headGeometry ? 'heads' : 'bodies'}`});
      }
    }
  }
  grandstand(-100, -1, 180, 12, true, 30);
  grandstand(120, -1, 130, 10, true, 29);
  grandstand(track.corners[0].distance + 100, -1, 110, 11, false, 62);
  // The operator's grandstand map places Seconda Variante/Roggia inside T5.
  grandstand(track.corners[4].distance + 40, 1, 70, 8, false, 40);
  grandstand(track.corners[8].distance - 15, 1, 130, 11, false, 63);
  grandstand(track.corners[10].distance + 210, -1, 135, 10, false, 65);

  // Braking boards and restrained signage are placed from the corner metadata.
  for (const index of [0, 3, 5, 6, 7, 10]) {
    const corner = track.corners[index];
    for (const metres of [150, 100, 50]) {
      const d = corner.distance - metres, s = track.sample(d);
      const side = index === 3 || index === 7 ? 1 : -1;
      const lateral = side * ((side < 0 ? s.barrierLeft : s.barrierRight) - .8);
      board(d, lateral, 2.45, 2.3, 1.7, String(metres), {resolution: 512});
      boxAt(d, lateral, 1, [.13, 2, .13], darkMetal, 0, false);
    }
    const d = corner.distance - 255, s = track.sample(d);
    board(d, -(s.barrierLeft - .6), 2.2, 7.2, 1.6, corner.name.toUpperCase(), {bg: '#2b393b', fg: '#e3e5d8', sub: `CURVA ${corner.number}`});
  }
  for (const {start: d} of track.drsZones) {
    const s = track.sample(d);
    board(d, -s.barrierLeft + .5, 2.05, 2.5, 1.3, 'DRS', {bg: '#173e33', fg: '#ffffff'});
  }
  for (const [d, side, title, subtitle] of [[330, -1, 'TEMPLE OF SPEED', 'MONZA · ITALIA'], [1450, -1, 'AUTODROMO NAZIONALE', 'DAL 1922'], [4300, 1, 'MONZA', 'LA PASSIONE NON SI FERMA']]) {
    const s = track.sample(d), lateral = side * (side < 0 ? s.barrierLeft : s.barrierRight);
    board(d, lateral, 2.35, 22, 2.15, title, {bg: '#274039', fg: '#e7e7d7', sub: subtitle, sideways: true});
  }

  // Simple marshal stations and stacked safety barriers at corner runoffs.
  for (const index of [0, 3, 5, 6, 7, 10]) {
    const d = track.corners[index].distance + 80, s = track.sample(d);
    const lateral = -(s.barrierLeft + 4);
    boxAt(d, lateral, 1.7, [3, 3.4, 3], white);
    boxAt(d, lateral, 3.55, [3.5, .3, 3.5], darkMetal);
    boxAt(d - 1.55, lateral, 2.3, [2.5, 1.4, .1], glass);
    for (let i = 0; i < 14; i++) boxAt(d + i * 2.1 - 12, -(s.barrierLeft - 1.1), .7, [1.2, 1.4, 2], i % 6 < 3 ? red : white, 0, false);
  }

  // The old north banking crosses Serraglio at the intersection of two OSM
  // centerlines (© OpenStreetMap contributors, ODbL; docs/TRACK.md). Position
  // and bearing are map references; dimensions and altitude remain authored.
  if (bridgeReference) {
    const [lon, lat] = bridgeReference.crossing.coordinates;
    const latitudeScale = 6371008.8 * Math.PI / 180;
    const longitudeScale = latitudeScale * Math.cos(track.origin.lat * Math.PI / 180);
    const center = new THREE.Vector3((lon - track.origin.lon) * longitudeScale * track.scale,
      0, (lat - track.origin.lat) * latitudeScale * track.scale);
    // Box X spans the elevated raceway; local Z follows the underpass axis.
    const heading = THREE.MathUtils.degToRad(bridgeReference.crossing.bearingDegrees) + Math.PI / 2;
    const across = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
    const along = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const bridgeBox = (lateral, longitudinal, height, dimensions, mat) => box(mat,
      center.clone().addScaledVector(across, lateral).addScaledVector(along, longitudinal)
        .addScaledVector(UP, height), dimensions, heading);
    bridgeBox(0, 0, 7.9, [57, 1.3, 11], concreteDark);
    bridgeBox(0, -5.35, 8.9, [57, .9, .22], concrete);
    bridgeBox(0, 5.35, 8.9, [57, .9, .22], concrete);
    for (const side of [-1, 1]) bridgeBox(side * 20, 0, 3.8, [2.5, 7.6, 10], concreteDark);
    sceneryClearances.push({center, heading, width: 57, length: 11});
  }

  // Broadleaf park canopy in crossed textured cards. Species share materials,
  // while spatial cells let camera and shadow frusta cull distant track areas.
  const treeCandidates = [];
  const treeCount = lowQuality ? 1400 : 2600;
  for (let i = 0; i < treeCount * 2 && treeCandidates.length < treeCount; i++) {
    const d = random() * track.length, side = random() > .5 ? 1 : -1, s = track.sample(d);
    if ((d < 390 || d > track.length - 520) && random() < .85) continue;
    const barrier = side < 0 ? s.barrierLeft : s.barrierRight;
    const lateral = side * (barrier + 11 + Math.pow(random(), .72) * 145);
    const p = s.position.clone().addScaledVector(s.right, lateral).addScaledVector(s.tangent, (random() - .5) * 20);
    const near = track.nearest(p.x, p.z);
    if (Math.abs(near.lateral) < Math.max(near.barrierLeft, near.barrierRight) + 8) continue;
    if ((near.distance < 310 || near.distance > track.length - 510) && near.lateral > 0 && near.lateral < 76) continue;
    if (sceneryClearances.some(({center, heading, width, length}) => {
      const dx = p.x - center.x, dz = p.z - center.z;
      const lateral = dx * Math.cos(heading) - dz * Math.sin(heading);
      const longitudinal = dx * Math.sin(heading) + dz * Math.cos(heading);
      return Math.abs(lateral) < width / 2 + 9 && Math.abs(longitudinal) < length / 2 + 9;
    })) continue;
    const height = 12 + random() * 15;
    treeCandidates.push({position: p, height, width: height * (.55 + random() * .2), rotation: random() * Math.PI, species: i % 3});
  }
  // The Royal Park continues behind the main tribunes. Deliberately seed this
  // tree line so the grid has wooded depth rather than an empty grass horizon.
  for (let i = 0; i < (lowQuality ? 110 : 190); i++) {
    const d = -390 + random() * 810, lateral = -(59 + random() * 88);
    const height = 17 + random() * 11;
    treeCandidates.push({position: pointAt(d, lateral, 0), height, width: height * (.52 + random() * .17),
      rotation: random() * Math.PI, species: i % 3});
  }
  const treeGeometry = new THREE.PlaneGeometry(1, 1); treeGeometry.translate(0, .5, 0);
  const photographicOak = await loadTexture('/textures/park-oak-v1.png', true);
  if(photographicOak){photographicOak.wrapS=photographicOak.wrapT=THREE.ClampToEdgeWrapping;photographicOak.anisotropy=4;}
  const foliageTexture = photographicOak || treeTexture(194, 0);
  if (!photographicOak) textures.push(foliageTexture);
  const foliageMaterial = material({map: foliageTexture, alphaTest: .38, side: THREE.DoubleSide,
    alphaToCoverage: true, roughness: 1, color: 0xffffff});
  const foliageColors = [0xc4cbb1, 0xb7c2a2, 0xced0ae].map(color => new THREE.Color(color));
  const cards = lowQuality ? 2 : 3;
  for (const [cell, candidates] of spatialBuckets(treeCandidates, t => [t.position.x, t.position.z])) {
    const trees = new THREE.InstancedMesh(treeGeometry, foliageMaterial, candidates.length * cards);
    let n = 0;
    for (const tree of candidates) for (let plane = 0; plane < cards; plane++) {
      dummy.position.copy(tree.position); dummy.rotation.set(0, tree.rotation + plane * Math.PI / cards, 0);
      dummy.scale.set(tree.width * (photographicOak ? 1.35 : 1), tree.height, 1); dummy.updateMatrix();
      trees.setMatrixAt(n, dummy.matrix); trees.setColorAt(n, foliageColors[tree.species]); n++;
    }
    finishInstances(trees, {cast: !lowQuality, name: `Park canopy · ${cell}`});
  }

  // Thin trunks in the foreground provide depth where foliage cards cross.
  const trunkGeometry = new THREE.CylinderGeometry(.2, .42, 1, 6);
  const trunkMaterial = material({color: 0x50463b, roughness: 1});
  for (const [cell, candidates] of spatialBuckets(treeCandidates, t => [t.position.x, t.position.z])) {
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, candidates.length);
    candidates.forEach((tree, i) => {
      dummy.position.copy(tree.position).addScaledVector(UP, tree.height * .22);
      dummy.rotation.set(0, tree.rotation, 0); dummy.scale.set(1, tree.height * .44, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    });
    finishInstances(trunks, {cast: !lowQuality, name: `Park trunks · ${cell}`});
  }

  // Small tufts break the road/grass boundary without excessive geometry.
  const tuftTexture = canvasTexture(128, 128, (ctx) => {
    const r = rng(8);
    for (let i = 0; i < 90; i++) {
      const x = 15 + r() * 100; ctx.strokeStyle = `rgb(${78 + r() * 45},${86 + r() * 39},${42 + r() * 22})`;
      ctx.lineWidth = 1 + r(); ctx.beginPath(); ctx.moveTo(x, 128); ctx.quadraticCurveTo(x + (r() - .5) * 35, 55, x + (r() - .5) * 45, 30 + r() * 80); ctx.stroke();
    }
  }); textures.push(tuftTexture);
  const tuftMaterial = material({map: tuftTexture, alphaTest: .4, side: THREE.DoubleSide, roughness: 1});
  const tuftCount = lowQuality ? 600 : 1800;
  const tuftMatrices = [];
  for (let i = 0; i < tuftCount; i++) {
    const d = random() * track.length, side = random() < .5 ? -1 : 1;
    dummy.position.copy(pointAt(d, side * (8.1 + random() * 1.8), 0));
    dummy.rotation.set(0, random() * Math.PI, 0); dummy.scale.set(.6 + random() * .8, .2 + random() * .5, 1); dummy.updateMatrix(); tuftMatrices.push(dummy.matrix.clone());
  }
  matrixChunks(treeGeometry, tuftMaterial, tuftMatrices, {name: 'Roadside grass'}, true);

  // A handful of flags close to the start animate visibly without expensive
  // cloth simulation; all other scenery is entirely static.
  const flagTexture = canvasTexture(384, 256, (ctx, w, h) => {
    ctx.fillStyle = '#287753'; ctx.fillRect(0, 0, w / 3, h); ctx.fillStyle = '#eee8d6'; ctx.fillRect(w / 3, 0, w / 3, h);
    ctx.fillStyle = '#ad2b25'; ctx.fillRect(w * 2 / 3, 0, w / 3, h);
  }); textures.push(flagTexture);
  const flagMaterial = material({map: flagTexture, side: THREE.DoubleSide, roughness: .9});
  for (const d of [-215, -130, -45, 45, 130]) {
    boxAt(d, -43, 6.4, [.12, 12.8, .12], metal);
    const g = new THREE.PlaneGeometry(3.4, 2.2, 12, 3); g.translate(1.7, 0, 0);
    const f = mesh(g, flagMaterial, true, false); f.position.copy(pointAt(d, -43, 11.2)); f.rotation.y = .8;
    dynamic.push({mesh: f, seed: d});
  }

  for (const {mat, entries, cast, response} of batches.values()) {
    const cells = spatialBuckets(entries, entry => [entry.matrix.elements[12], entry.matrix.elements[14]]);
    for (const [cell, transforms] of cells) {
      const instances = new THREE.InstancedMesh(boxGeometry, mat, transforms.length);
      transforms.forEach(({matrix, color}, i) => {instances.setMatrixAt(i, matrix); instances.setColorAt(i, color);});
      finishInstances(instances, {cast, name: `Circuit structures · ${response} · ${cell}`});
    }
  }
  root.userData.track = {name: 'Autodromo Nazionale Monza', length: track.length, trees: treeCandidates.length};
  root.userData.spatialBatches = spatialBatchStats;
  let wet = false;
  return {
    root,startSignal,trackDetails,pitComplex,landmarks,
    update(dt, time, carState) {
      for (const flag of dynamic) {
        const p = flag.mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i); p.setZ(i, Math.sin(x * 3.2 - time * 3 + flag.seed) * .17 * (x / 3.4));
        }
        p.needsUpdate = true; flag.mesh.geometry.computeVertexNormals();
      }
    },
    setWeather(preset) {
      wet = preset === 'wet' || preset === 'rain' || preset === 'rainy';
      asphalt.roughness = wet ? .22 : .98; asphalt.color.setHex(wet ? 0x6d777d : 0xa6a8ac);
      roadRoughnessFloor.value = wet ? .16 : .91;
      asphalt.metalness = wet ? .16 : 0;
      grass.color.setHex(wet ? 0x788c73 : 0xa5b095);
    },
    dispose() {
      root.traverse(object => {if (object.geometry) object.geometry.dispose();});
      for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
      scene.remove(root);
    },
  };
}
