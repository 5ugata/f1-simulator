import * as THREE from 'three';
import {publicAsset} from './assets.js';

// Public geographic centerline, projected to physical metres. See docs/TRACK.md.
const TRACK_LENGTH = 5793;
const SAMPLES = 2896;
const EARTH_RADIUS = 6371008.8;
const wrap = (v, n) => ((v % n) + n) % n;
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export async function createTrack() {
  const response = await fetch(publicAsset('data/monza.geojson'));
  if (!response.ok) throw new Error('Unable to load the Monza geographic centerline.');
  return createTrackFromGeoJSON(await response.json());
}

export function createTrackFromGeoJSON(geojson) {
  const coordinates = geojson.features[0].geometry.coordinates;
  const [originLon, originLat] = coordinates[0];
  const latitudeScale = EARTH_RADIUS * Math.PI / 180;
  const longitudeScale = latitudeScale * Math.cos(originLat * Math.PI / 180);
  const project = ([lon, lat]) => new THREE.Vector3(
    (lon - originLon) * longitudeScale, 0, (lat - originLat) * latitudeScale,
  );
  const source = coordinates.slice(0, -1).map(project);

  // Densification prevents long straight-line control handles distorting the
  // tight Rettifilo and Roggia chicanes. Centripetal interpolation rounds joins.
  const controls = [];
  source.forEach((p, index) => {
    const next = source[(index + 1) % source.length];
    const subdivisions = Math.max(1, Math.ceil(p.distanceTo(next) / 10));
    for (let i = 0; i < subdivisions; i++) controls.push(p.clone().lerp(next, i / subdivisions));
  });
  const curve = new THREE.CatmullRomCurve3(controls, true, 'centripetal');
  curve.arcLengthDivisions = 24000;
  const geographicLength = curve.getLength();
  const scale = TRACK_LENGTH / geographicLength;
  const points = curve.getSpacedPoints(SAMPLES).slice(0, SAMPLES).map(p => p.multiplyScalar(scale));
  const spacing = TRACK_LENGTH / SAMPLES;
  const tangents = points.map((_, i) => points[(i + 1) % SAMPLES].clone()
    .sub(points[wrap(i - 1, SAMPLES)]).normalize());
  const headings = tangents.map(t => Math.atan2(t.x, t.z));
  const curvatures = headings.map((_, i) => angleDelta(headings[(i + 2) % SAMPLES], headings[wrap(i - 2, SAMPLES)]) / (4 * spacing));
  const bounds = points.reduce((b, p) => ({
    minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
    minZ: Math.min(b.minZ, p.z), maxZ: Math.max(b.maxZ, p.z),
  }), {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity});
  const width = 12;
  let sceneryProfiles = [], towerClearances = [];
  function widthAt(distance) {
    // Geographic data has no surveyed edge widths; 12 m is the published maximum.
    return width;
  }

  function sample(distance) {
    const d = wrap(distance, TRACK_LENGTH);
    const location = d / spacing;
    const index = Math.floor(location);
    const alpha = location - index;
    const next = (index + 1) % SAMPLES;
    const position = points[index].clone().lerp(points[next], alpha);
    const tangent = tangents[index].clone().lerp(tangents[next], alpha).normalize();
    const heading = Math.atan2(tangent.x, tangent.z);
    const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
    let barrierLeft = 17, barrierRight = 17;
    for (const profile of sceneryProfiles) {
      const difference = Math.abs(angleDelta((d / TRACK_LENGTH) * Math.PI * 2,
        (profile.distance / TRACK_LENGTH) * Math.PI * 2)) * TRACK_LENGTH / (Math.PI * 2);
      const influence = Math.max(0, 1 - difference / profile.radius);
      const blend = influence * influence * (3 - 2 * influence);
      barrierLeft = Math.max(barrierLeft, THREE.MathUtils.lerp(17, profile.left, blend));
      barrierRight = Math.max(barrierRight, THREE.MathUtils.lerp(17, profile.right, blend));
    }
    if (d < 280 || d > TRACK_LENGTH - 460) {barrierLeft = 14; barrierRight = 9.5;}
    // Route the same visible/collision barrier in front of the two mapped
    // hospitality towers. The old constant offset ran through their bases.
    for(const tower of towerClearances){
      const delta=Math.abs(d-tower.distance),gap=Math.min(delta,TRACK_LENGTH-delta);
      if(gap>=tower.halfLength+25)continue;
      const t=THREE.MathUtils.clamp((gap-tower.halfLength)/25,0,1),blend=t*t*(3-2*t);
      barrierLeft=Math.min(barrierLeft,THREE.MathUtils.lerp(tower.clearance,barrierLeft,blend));
    }
    return {position, tangent, right, heading, barrierLeft, barrierRight,
      runoffLeft: Math.max(8, barrierLeft - 3), runoffRight: Math.max(8, barrierRight - 3),
      curvature: THREE.MathUtils.lerp(curvatures[index], curvatures[next], alpha),
      width: widthAt(d), distance: d};
  }

  const CELL_SIZE = 48;
  const grid = new Map();
  points.forEach((p, index) => {
    const key = `${Math.floor(p.x / CELL_SIZE)},${Math.floor(p.z / CELL_SIZE)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(index);
  });

  function nearest(x, z, hintDistance) {
    let bestSq = Infinity;
    let bestIndex = 0;
    let bestT = 0;
    const test = index => {
      index = wrap(index, SAMPLES);
      const a = points[index], b = points[(index + 1) % SAMPLES];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const ex = x - a.x - dx * t, ez = z - a.z - dz * t;
      const sq = ex * ex + ez * ez;
      if (sq < bestSq) {bestSq = sq; bestIndex = index; bestT = t;}
    };
    const cellX = Math.floor(x / CELL_SIZE), cellZ = Math.floor(z / CELL_SIZE);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const candidates = grid.get(`${cellX + dx},${cellZ + dz}`);
      if (candidates) for (const index of candidates) {test(index); test(index - 1);}
    }
    if (!Number.isFinite(bestSq) || bestSq > CELL_SIZE * CELL_SIZE) {
      // The full fallback also makes map-click resets and wildly off-track
      // positions reliable, irrespective of a stale hint from the car.
      for (let index = 0; index < SAMPLES; index += 12) test(index);
      const around = bestIndex;
      for (let index = around - 14; index <= around + 14; index++) test(index);
    }
    const distance = wrap((bestIndex + bestT) * spacing, TRACK_LENGTH);
    const result = sample(distance);
    result.lateral = (x - result.position.x) * result.right.x + (z - result.position.z) * result.right.z;
    return result;
  }

  const cornerCoordinates = [
    ['Rettifilo', 1, 9.281994, 45.624553],
    ['Rettifilo', 2, 9.282479, 45.624675],
    ['Curva Grande', 3, 9.283669, 45.629196],
    ['Roggia', 4, 9.291405, 45.630200],
    ['Roggia', 5, 9.291748, 45.630567],
    ['Lesmo 1', 6, 9.296246, 45.631194],
    ['Lesmo 2', 7, 9.296773, 45.628408],
    ['Ascari', 8, 9.285876, 45.622578],
    ['Ascari', 9, 9.285864, 45.621833],
    ['Ascari', 10, 9.285107, 45.621196],
    ['Parabolica', 11, 9.282710, 45.611858],
  ];
  const corners = cornerCoordinates.map(([name, number, lon, lat]) => {
    const point = project([lon, lat]).multiplyScalar(scale);
    return {name, number, distance: nearest(point.x, point.z).distance};
  });
  // © OpenStreetMap contributors, ODbL: nodes 2396630508 / 2396630532.
  // The 6×7.2 m tower envelopes and 0.30 m guardrail gap are authored. Keep
  // these point coordinates in sync with public/data/monza-landmarks.json.
  towerClearances=[
    {name:'Torre Nord',node:2396630508,coordinates:[9.2813278,45.6214439]},
    {name:'Torre Sud',node:2396630532,coordinates:[9.2806411,45.6161958]},
  ].map(tower=>{
    const p=project(tower.coordinates).multiplyScalar(scale),near=nearest(p.x,p.z);
    return {...tower,distance:near.distance,clearance:Math.abs(near.lateral)-3-.30,halfLength:5.6};
  });
  // Preserve the geographic start-grid origin. Monza's control/finish line is
  // 309 m behind the grid; timing uses a separate distance origin (docs/TRACK.md).
  const startLineDistance = 0;
  const controlLineDistance = TRACK_LENGTH - 309;
  const toLapDistance = distance => wrap(distance - controlLineDistance, TRACK_LENGTH);
  const fromLapDistance = distance => wrap(distance + controlLineDistance, TRACK_LENGTH);
  sceneryProfiles = [
    {distance: corners[0].distance, radius: 210, left: 45, right: 42},
    {distance: corners[2].distance, radius: 450, left: 30, right: 18},
    {distance: corners[3].distance, radius: 170, left: 42, right: 40},
    {distance: corners[5].distance, radius: 150, left: 44, right: 17},
    {distance: corners[6].distance, radius: 145, left: 42, right: 17},
    {distance: corners[8].distance, radius: 265, left: 45, right: 42},
    {distance: corners[10].distance, radius: 310, left: 65, right: 20},
  ];
  // Activation offsets follow the 2025 FIA event map. End points remain
  // authored braking gates, not published FIA deactivation coordinates.
  const drsZones = [
    {name: 'Rettifilo', start: controlLineDistance + 12, end: corners[0].distance - 170},
    {name: 'Serraglio', start: corners[6].distance + 170, end: corners[7].distance - 180},
  ];
  const isDrsZone = distance => drsZones.some(({start, end}) =>
    wrap(distance - start, TRACK_LENGTH) < wrap(end - start, TRACK_LENGTH));
  // Authored visible surface bands, measured outwards from the centerline.
  // world.js consumes the same bounds; these are not surveyed Monza edges.
  const surfaceBands = {
    apron: {inner: width / 2, outer: 7.4},
    shoulder: {inner: 7.3, outer: 8},
    kerb: {inner: 6.04, outer: 7.55},
    kerbRunoff: {inner: 7.55, outer: 8.8},
    runoffPaint: {inner: 7.4, outer: 9.15},
    gravelTrap: {inner: 9, barrierClearance: 3},
  };
  const kerbSections = [
    [0, -28, 20, 1], [1, -28, 55, -1], [2, -160, 200, 1],
    [3, -30, 25, -1], [4, -25, 40, 1], [5, -58, 62, 1], [5, 30, 110, -1],
    [6, -30, 45, 1], [6, 22, 90, -1], [7, -25, 40, -1],
    [8, -25, 33, 1], [9, -28, 55, -1], [10, -100, 205, 1], [10, 70, 245, -1],
  ].map(([index, begin, finish, side]) => ({
    corner: corners[index].number, start: corners[index].distance + begin,
    end: corners[index].distance + finish, side,
  }));
  const runoffSections = [
    [corners[0].distance - 95, corners[1].distance + 90, -1],
    [corners[3].distance - 75, corners[4].distance + 85, 1],
    [corners[5].distance - 85, corners[5].distance + 95, -1],
    [corners[6].distance - 75, corners[6].distance + 115, -1],
    [corners[7].distance - 80, corners[9].distance + 70, -1],
    [corners[8].distance - 65, corners[9].distance + 65, 1],
    [corners[10].distance - 130, corners[10].distance + 250, -1],
  ];
  const surfaceAt = (distance, lateral) => {
    const offset = Math.abs(lateral);
    if (offset <= width / 2) return 'asphalt';
    const d = wrap(distance, TRACK_LENGTH), side = Math.sign(lateral);
    const inSection = (start, end) => wrap(d - start, TRACK_LENGTH) <= end - start;
    const inBand = ({inner, outer}) => offset >= inner && offset <= outer;
    const hasKerb = kerbSections.some(section => section.side === side && inSection(section.start, section.end));
    // Match the raised layers in world.js: kerbs cover apron/shoulder/paint;
    // green paved runoff covers the lower earthy shoulder and gravel edge.
    if (hasKerb && inBand(surfaceBands.kerb)) return 'kerb';
    if (hasKerb && inBand(surfaceBands.kerbRunoff)) return 'asphalt';
    const hasTrap = runoffSections.some(([start, end, s]) => s === side && inSection(start, end));
    if (hasTrap && inBand(surfaceBands.runoffPaint)) return 'asphalt';
    if (inBand(surfaceBands.shoulder)) return 'gravel';
    if (inBand(surfaceBands.apron)) return 'asphalt';
    if (hasTrap && offset >= surfaceBands.gravelTrap.inner) {
      const frame = sample(d);
      const outer = (side < 0 ? frame.barrierLeft : frame.barrierRight) - surfaceBands.gravelTrap.barrierClearance;
      if (offset <= outer) return 'gravel';
    }
    return 'grass';
  };
  // Published 2025 FIA offsets applied to our mapped corner references; the
  // resulting positions inherit their geographic approximation.
  const sectors = [corners[3].distance - 233, corners[7].distance - 215];
  const lapSectors = sectors.map(toLapDistance).sort((a, b) => a - b);
  return {length: TRACK_LENGTH, width, points, spacing, sample, nearest,
    corners, sectors, lapSectors, startLineDistance, controlLineDistance, toLapDistance, fromLapDistance,
    bounds, geographicLength, scale, drsZones, isDrsZone, surfaceBands, kerbSections, surfaceAt, runoffSections,towerClearances,
    origin: {lat: originLat, lon: originLon}};
}
