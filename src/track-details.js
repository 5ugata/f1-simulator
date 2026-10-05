import * as THREE from 'three';

// The colours and construction details follow post-resurfacing August 2024
// photographs. Dimensions and positions remain authored; docs/references/
// track-details.md records the references and the unchanged contact contract.
const UP = new THREE.Vector3(0, 1, 0);
const KERB_COLOURS = [0x16855c, 0xe9e8df, 0xc52f2d, 0xe9e8df];
const ORANGE = 0xe66b16;

function point(track, distance, lateral, height) {
  const s = track.sample(distance);
  return s.position.addScaledVector(s.right, lateral).addScaledVector(UP, height);
}

function geometryFromQuads(quads) {
  const positions = [], colours = [], indices = [];
  const c = new THREE.Color();
  for (const {points, colour} of quads) {
    const base = positions.length / 3;
    c.setHex(colour);
    for (const p of points) {
      positions.push(p.x, p.y, p.z);
      colours.push(c.r, c.g, c.b);
    }
    // Winding follows world.js's north-positive road ribbons. The containing
    // world root is responsible for the single simulation/render reflection.
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function kerbGeometry(track, section) {
  const {start, end, side, corner} = section;
  const {inner, outer} = track.surfaceBands.kerb;
  const apex = track.corners.find(c => c.number === corner).distance;
  const bevelled = [1, 2, 4, 5].includes(corner);
  const quads = [];
  // Slabs have sharply separated painted faces, a low outer bevel and tiny
  // moulded seams. They replace the old flat ribbon plus tall concrete ribs.
  for (let slab = start; slab < end; slab += 2.5) {
    const slabEnd = Math.min(end, slab + 2.5);
    const colour = KERB_COLOURS[Math.round((slab - start) / 2.5) % 4];
    const steps = Math.ceil((slabEnd - slab) / .65);
    for (let i = 0; i < steps; i++) {
      const a = THREE.MathUtils.lerp(slab, slabEnd, i / steps);
      const b = THREE.MathUtils.lerp(slab, slabEnd, (i + 1) / steps);
      const shoulder = outer - .29;
      const profile = d => {
        const orangeHeight = bevelled ? .065 * Math.max(0, 1 - Math.abs(d - apex) / 17) : 0;
        const seam = Math.min(d - slab, slabEnd - d) < .01 ? -.003 : 0;
        return [
          [inner, .029], [inner + .13, .046 + seam],
          [shoulder, .067 + seam], [shoulder + .045, .066 + orangeHeight + seam],
          [outer, .029],
        ];
      };
      const pa = profile(a), pb = profile(b);
      for (let j = 0; j < pa.length - 1; j++) {
        const ordered = side > 0 ? [j, j + 1] : [j + 1, j];
        const paintOrange = bevelled && j >= 2 && Math.abs((a + b) * .5 - apex) < 17;
        quads.push({colour: paintOrange ? ORANGE : colour, points: [
          point(track, a, side * pa[ordered[0]][0], pa[ordered[0]][1]),
          point(track, a, side * pa[ordered[1]][0], pa[ordered[1]][1]),
          point(track, b, side * pb[ordered[0]][0], pb[ordered[0]][1]),
          point(track, b, side * pb[ordered[1]][0], pb[ordered[1]][1]),
        ]});
      }
    }
  }
  return geometryFromQuads(quads);
}

function canvasTexture(textures, width, height, paint) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textures.push(texture); return texture;
}

export function createTrackDetails({track, root, material, mesh, boxAt, pointAt, roadMesh, textures}) {
  const paintedConcrete = material({vertexColors: true, roughness: .89});
  const green = material({color: 0x25835f, roughness: .96});
  const steel = material({color: 0x8f9996, roughness: .56, metalness: .63});
  const dark = material({color: 0x202827, roughness: .68, metalness: .35});
  const stats = {referenceYear: 2024, kerbSections: 0, catchFenceSections: 0, marshalPanels: 0};

  for (const section of track.kerbSections) {
    const kerb = mesh(kerbGeometry(track, section), paintedConcrete, true, false);
    kerb.name = `Monza tri-colour kerb · T${section.corner} · ${section.side < 0 ? 'left' : 'right'}`;
    const {inner, outer} = track.surfaceBands.kerbRunoff;
    roadMesh(section.start, section.end, section.side * inner, section.side * outer, .015, green, 1);
    stats.kerbSections++;
  }

  // Finer upper catch mesh and its inward-leaning supports are modelled only
  // in the main spectator/corner areas. Existing guardrails and lower fencing
  // remain intact, at the same barrier limits used by the vehicle physics.
  const net = canvasTexture(textures, 128, 128, ctx => {
    ctx.strokeStyle = '#a7b0a8'; ctx.lineWidth = 1.5;
    for (let x = -128; x < 256; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 128, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 128, 128); ctx.stroke();
    }
  });
  net.wrapS = net.wrapT = THREE.RepeatWrapping;
  const netMaterial = material({map: net, alphaTest: .25, side: THREE.DoubleSide, roughness: .75, metalness: .3});
  const beamGeometry = new THREE.BoxGeometry(1, 1, 1);
  const c = number => track.corners.find(corner => corner.number === number).distance;
  const fenceSections = [
    {start: track.length - 380, end: track.length + 150, side: -1},
    {start: c(1) - 90, end: c(2) + 80, side: -1},
    {start: c(1) - 55, end: c(2) + 80, side: 1},
    {start: c(4) - 65, end: c(5) + 60, side: 1},
    {start: c(8) - 50, end: c(10) + 50, side: -1},
    {start: c(8) - 30, end: c(10) + 50, side: 1},
    {start: c(11) - 90, end: c(11) + 225, side: -1},
  ];
  const dummy = new THREE.Object3D();
  for (const {start, end, side} of fenceSections) {
    const positions = [], uv = [], indices = [], beamTransforms = [];
    const count = Math.ceil((end - start) / 5);
    let previousBottom, previousTop;
    const beam = (a, b, thickness = .07) => {
      const delta = b.clone().sub(a);
      dummy.position.copy(a).lerp(b, .5);
      dummy.quaternion.setFromUnitVectors(UP, delta.clone().normalize());
      dummy.scale.set(thickness, delta.length(), thickness);
      dummy.updateMatrix(); beamTransforms.push(dummy.matrix.clone());
    };
    for (let i = 0; i <= count; i++) {
      const d = THREE.MathUtils.lerp(start, end, i / count), s = track.sample(d);
      const edge = side < 0 ? s.barrierLeft : s.barrierRight;
      const bottom = pointAt(d, side * (edge + .28), 3.40);
      const top = pointAt(d, side * (edge - .36), 4.65);
      positions.push(bottom.x, bottom.y, bottom.z, top.x, top.y, top.z);
      uv.push((d - start) / 2, 0, (d - start) / 2, .7);
      if (i < count) {const k = i * 2; indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);}
      if (i % 2 === 0 || i === count) {
        // A continuous lower mast anchors each lean-back arm. The old lower
        // fence samples use a different spacing and cannot be its support.
        beam(pointAt(d, side * (edge + .28), .94), bottom, .085);
        beam(bottom, top, .085);
      }
      if (previousTop) {
        beam(previousTop, top, .035);
        if (i % 4 === 0) beam(previousBottom, top, .032);
      }
      previousBottom = bottom; previousTop = top;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const upper = mesh(geometry, netMaterial, false, false);
    upper.name = 'Monza angled upper catch fence';
    const supports = new THREE.InstancedMesh(beamGeometry, steel, beamTransforms.length);
    beamTransforms.forEach((transform, i) => supports.setMatrixAt(i, transform));
    supports.name = 'Monza catch-fence braces';
    supports.computeBoundingBox(); supports.computeBoundingSphere(); root.add(supports);
    stats.catchFenceSections++;
  }

  // A conservative subset at the existing six marshal stations. These are
  // authored positions, not the numerical FIA light locations. Dark lenses
  // avoid inventing a track flag state in this single-car practice session.
  const panelTexture = canvasTexture(textures, 256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#101513'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#29332a';
    for (let x = 5; x < w; x += 8) for (let y = 5; y < h; y += 8) {
      ctx.beginPath(); ctx.arc(x, y, 1.25, 0, Math.PI * 2); ctx.fill();
    }
  });
  const panelMaterial = material({map: panelTexture, roughness: .57, side: THREE.DoubleSide});
  const panelGeometry = new THREE.PlaneGeometry(1.2, .9);
  const panelPositions = [];
  for (const number of [1, 4, 6, 7, 8, 11]) {
    const d = c(number) + 80, s = track.sample(d);
    const lateral = -(s.barrierLeft + .75), height = 3.32;
    boxAt(d, lateral, 1.87, [.14, 3.74, .14], steel, 0, false);
    boxAt(d, lateral, height, [1.38, 1.08, .20], dark);
    boxAt(d - .16, lateral, height + .55, [1.47, .07, .42], dark, 0, false);
    // Stop short of the guardrail collision plane at every station. Supports
    // are on the service side; only the display face points up the approach.
    const panel = mesh(panelGeometry, panelMaterial, false, false);
    panel.position.copy(pointAt(d - .106, lateral, height));
    panel.rotation.y = s.heading + Math.PI;
    panel.name = `Unlit marshal LED panel · near T${number}`;
    panelPositions.push({corner: number, distance: d, lateral});
    stats.marshalPanels++;
  }
  root.userData.trackDetails = {...stats, marshalPanelPositions: panelPositions};
  return stats;
}
