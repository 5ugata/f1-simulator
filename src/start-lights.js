import * as THREE from 'three';

// Art. 36.10 of the 2021 FIA Sporting Regulations: build five red columns,
// then extinguish every red together. The final hold belongs to the starter.
// The preparation delay and default hold below are simulator choices.
export const START_SEQUENCE = Object.freeze({prepare: .7, interval: 1, columns: 5, defaultHold: 1.4});

export function getStartSequence(elapsed, hold = START_SEQUENCE.defaultHold) {
  const finalHold = Number.isFinite(hold) ? Math.max(.05, hold) : START_SEQUENCE.defaultHold;
  const duration = START_SEQUENCE.prepare + (START_SEQUENCE.columns - 1) * START_SEQUENCE.interval + finalHold;
  const time = Number.isFinite(elapsed) ? elapsed : 0;
  const released = time >= duration;
  // Compare against the absolute boundaries. Subtracting a fractional prepare
  // delay first can move exact instants such as 1.7 s below their next column.
  let litCount = 0;
  if (!released) for (let column = 0; column < START_SEQUENCE.columns; column++) {
    if (time >= START_SEQUENCE.prepare + column * START_SEQUENCE.interval) litCount++;
  }
  return {litCount, released, duration};
}

// This is a visual reconstruction of the left-hand cantilever visible in the
// September 2022 Monza panorama, not a surveyed structural model. See the
// references note for the evidence and each authored dimension.
export const START_GANTRY = Object.freeze({
  station: 80,
  supportLateral: -15.6,
  signalCenterLateral: .1,
  supportHeight: 8.8,
  lampRadius: .185,
  columnSpacing: .71,
  lowerLampHeight: 5.45,
  upperLampHeight: 5.98,
  minimumClearance: 5.06,
});

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();

function diodeTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x % 7) - 3, dy = (y % 7) - 3;
    const value = dx * dx + dy * dy <= 5 ? 255 : 85;
    const index = (y * size + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
    pixels[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  texture.name = 'Authored LED diode pattern';
  return texture;
}

export function createStartGantry({track, root, material, textures}, {station = START_GANTRY.station} = {}) {
  const frame = track.sample(station);
  const gantry = new THREE.Group();
  gantry.name = 'Monza starting signal · left cantilever';
  gantry.position.copy(frame.position);
  gantry.rotation.y = frame.heading;
  root.add(gantry);

  const steel = material({color: 0x333b3c, metalness: .7, roughness: .52});
  const black = material({color: 0x101414, metalness: .32, roughness: .67});
  const hoodMaterial = material({color: 0x101414, metalness: .25, roughness: .73, side: THREE.DoubleSide});
  const concrete = material({color: 0xa1a09a, roughness: .94});
  const screen = material({color: 0x0c1010, roughness: .8});
  const batches = new Map();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), direction = new THREE.Vector3();

  function instance(geometry, mat, center, dimensions, rotation = IDENTITY) {
    const key = `${geometry.uuid}:${mat.uuid}`;
    if (!batches.has(key)) batches.set(key, {geometry, mat, matrices: []});
    matrix.compose(position.set(...center), rotation, scale.set(...dimensions));
    batches.get(key).matrices.push(matrix.clone());
  }
  function box(mat, center, dimensions) {instance(boxGeometry, mat, center, dimensions);}
  function bar(from, to, thickness, mat = steel, round = false) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const length = a.distanceTo(b);
    direction.copy(b).sub(a).normalize();
    quaternion.setFromUnitVectors(Y_AXIS, direction);
    instance(round ? cylinderGeometry : boxGeometry, mat, a.add(b).multiplyScalar(.5).toArray(),
      [thickness, length, thickness], quaternion);
  }

  const pole = START_GANTRY.supportLateral;
  // The support sits behind the existing left barrier (14 m from centerline).
  // Nothing descends into the road or the right-hand pitlane.
  box(concrete, [pole, .27, .1], [1.7, .54, 2]);
  box(steel, [pole, .59, .1], [.98, .12, 1.28]);
  for (const z of [-.35, .55]) {
    bar([pole, .65, z], [pole, START_GANTRY.supportHeight, z], .23);
  }
  for (let y = 1; y < 8.3; y += 1.08) {
    bar([pole, y, -.35], [pole, y + .8, .55], .06);
    bar([pole, y + .8, -.35], [pole, y, .55], .06);
  }
  // Slim triangulated arm and a rear service rail; the real structure is a
  // cantilever, not the full-width branded arch previously shown here.
  const armEnd = 2.4, armHeight = 7.05;
  for (const z of [-.33, .53]) {
    bar([pole, armHeight, z], [armEnd, armHeight, z], .16);
    bar([pole, armHeight + .65, z], [armEnd, armHeight + .65, z], .11);
    const bays = 12, step = (armEnd - pole) / bays;
    for (let i = 0; i < bays; i++) {
      const x = pole + i * step;
      bar([x, armHeight, z], [x + step, armHeight + .65, z], .055);
      bar([x, armHeight + .65, z], [x + step, armHeight, z], .045);
    }
  }
  for (let i = 0; i <= 12; i++) {
    const x = pole + i * (armEnd - pole) / 12;
    bar([x, armHeight, -.33], [x, armHeight, .53], .07);
  }
  bar([pole, START_GANTRY.supportHeight, -.35], [-3.25, armHeight + .65, -.33], .027, steel, true);
  bar([pole, START_GANTRY.supportHeight, .55], [-3.25, armHeight + .65, .53], .027, steel, true);
  // Protected access ladder and electrical cabinet are deliberately on the
  // grandstand side; their dimensions are authored construction details.
  for (const x of [pole - .43, pole + .03]) bar([x, .6, .71], [x, 7.15, .71], .045);
  for (let y = .78; y < 7.2; y += .32) bar([pole - .43, y, .71], [pole + .03, y, .71], .035);
  box(black, [pole - .72, 1.35, .11], [.55, 1.15, .52]);

  const center = START_GANTRY.signalCenterLateral;
  // Dark race-control information panel above the five independent housings.
  // Blank in free practice; it never displays a green race-start signal.
  box(black, [center, 6.96, -.42], [4.32, .91, .31]);
  box(screen, [center, 6.96, -.584], [4.07, .70, .015]);
  box(steel, [center, 6.51, -.43], [4.33, .065, .36]);
  for (const x of [center - 1.77, center + 1.77]) bar([x, 6.36, -.42], [x, 7.14, -.1], .07);
  // Small rear cooling fins keep the panel legible as hardware from a chase
  // camera after crossing underneath. They share the static black batch.
  for (let x = center - 1.9; x < center + 2; x += .24) box(black, [x, 6.96, -.20], [.045, .59, .15]);

  const hoodGeometry = new THREE.CylinderGeometry(START_GANTRY.lampRadius + .047,
    START_GANTRY.lampRadius + .047, .36, 18, 1, true, Math.PI / 2, Math.PI);
  hoodGeometry.rotateX(Math.PI / 2);
  const barrelGeometry = new THREE.CylinderGeometry(START_GANTRY.lampRadius + .022,
    START_GANTRY.lampRadius + .022, .26, 20);
  barrelGeometry.rotateX(Math.PI / 2);
  const lensGeometry = new THREE.CircleGeometry(START_GANTRY.lampRadius, 28);
  lensGeometry.rotateY(Math.PI); // face upstream in simulation +Z coordinates
  const diodeMap = diodeTexture();
  textures.push(diodeMap);
  const columns = [];

  for (let column = 0; column < START_SEQUENCE.columns; column++) {
    const lateral = center + (column - 2) * START_GANTRY.columnSpacing;
    box(black, [lateral, 5.77, -.43], [.57, 1.42, .28]);
    // The signal is a narrow-band red LED, not an overexposed warm surface.
    // Bypass material tone mapping in the direct renderer and keep radiance
    // below ACES' desaturating shoulder for the composer's global OutputPass.
    const lampMat = material({color: 0x260403, map: diodeMap,
      emissive: 0xff0000, emissiveMap: diodeMap, emissiveIntensity: 0,
      roughness: .82, envMapIntensity: 0, toneMapped: false});
    const lamps = new THREE.InstancedMesh(lensGeometry, lampMat, 2);
    lamps.name = `Start red column ${column + 1}`;
    lamps.userData.column = column;
    lamps.receiveShadow = false;
    lamps.castShadow = false;
    for (const [row, height] of [START_GANTRY.upperLampHeight, START_GANTRY.lowerLampHeight].entries()) {
      instance(barrelGeometry, black, [lateral, height, -.66], [1, 1, 1]);
      instance(hoodGeometry, hoodMaterial, [lateral, height, -.79], [1, 1, 1]);
      matrix.makeTranslation(lateral, height, -.805);
      lamps.setMatrixAt(row, matrix);
    }
    lamps.computeBoundingBox(); lamps.computeBoundingSphere();
    gantry.add(lamps);
    columns.push(lamps);
  }

  for (const {geometry, mat, matrices} of batches.values()) {
    const instances = new THREE.InstancedMesh(geometry, mat, matrices.length);
    instances.name = mat === hoodMaterial ? 'Start lamp sun hoods' : 'Start gantry hardware';
    matrices.forEach((transform, i) => instances.setMatrixAt(i, transform));
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.computeBoundingBox(); instances.computeBoundingSphere();
    gantry.add(instances);
  }
  const metadata = Object.freeze({
    type: 'left cantilever', station, columns: 5, lampsPerColumn: 2,
    facing: 'upstream', supportLateral: pole,
    minimumClearance: START_GANTRY.minimumClearance,
    reference: 'Google Maps panorama CIHM0ogKEICAgICe2v6NtAE · September 2022',
    fidelity: 'Photo-informed proportions; positions and dimensions are authored, not surveyed',
  });
  gantry.userData.startSignal = metadata;
  let litCount = -1;
  function setState(count) {
    const next = Number.isFinite(count) ? Math.max(0, Math.min(5, Math.floor(count))) : 0;
    if (next === litCount) return;
    litCount = next;
    columns.forEach((lamps, index) => {
      const on = index < next;
      lamps.material.color.setHex(0x260403);
      lamps.material.emissiveIntensity = on ? .8 : 0;
      lamps.userData.lit = on;
    });
    gantry.userData.litCount = litCount;
  }
  setState(0);
  return {root: gantry, setState, metadata, columns, get litCount() {return litCount;}};
}
