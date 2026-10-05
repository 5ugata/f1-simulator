import * as THREE from 'three';
import {publicAsset} from './assets.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const EARTH_RADIUS = 6371008.8;
const BASE = .045;

// The same local projection and uniform length scale as track.js. Keep these
// points in simulation coordinates; worldRoot supplies the Z reflection.
export function projectMonzaCoordinate(track, [longitude, latitude]) {
  const metresPerDegree = EARTH_RADIUS * Math.PI / 180;
  return new THREE.Vector3(
    (longitude - track.origin.lon) * metresPerDegree * Math.cos(track.origin.lat * Math.PI / 180) * track.scale,
    0, (latitude - track.origin.lat) * metresPerDegree * track.scale,
  );
}

function openRing(points) {
  if (points.length > 2 && points[0].distanceToSquared(points.at(-1)) < 1e-8) return points.slice(0, -1);
  return points;
}

function ringArea(points) {
  return points.reduce((area, p, i) => {
    const q = points[(i + 1) % points.length];
    return area + p.x * q.z - q.x * p.z;
  }, 0) / 2;
}

function polygonGeometry(points, bottom, height, wallColor, roofColor) {
  // Shape XY becomes world XZ; this rotation gives extrusion a positive Y.
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, -p.z)));
  const geometry = new THREE.ExtrudeGeometry(shape, {depth: height, bevelEnabled: false, steps: 1, curveSegments: 1});
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, bottom, 0);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const wall = new THREE.Color(wallColor), roof = new THREE.Color(roofColor);
  for (const group of geometry.groups) {
    const color = group.materialIndex === 0 ? roof : wall;
    for (let i = group.start; i < group.start + group.count; i++) color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.clearGroups();
  return geometry;
}

/**
 * OSM supplies exact copied map footprints and two tower points. The facade
 * treatments and all heights are authored, as recorded beside the source data.
 * Call before the world builder places trees or finalizes its box instances.
 */
export function createMonzaLandmarks(context, referenceData) {
  const {track, root, material, mesh, box, sceneryClearances} = context;
  const stats = {source: publicAsset('data/monza-landmarks.json'), mappedBuildings: 0, mappedTowers: 0,
    detailBoxes: 0, meshBatches: 0, extrusionTriangles: 0, triangles: 0, features: [], skipped: []};
  if (!Array.isArray(referenceData?.features)) return stats;

  const concrete = material({color: 0xb8b9b2, roughness: .93});
  const cream = material({color: 0xd9d6c8, roughness: .93});
  const silver = material({color: 0xb5b9ba, roughness: .43, metalness: .64});
  const dark = material({color: 0x303d40, roughness: .75});
  const glazing = material({color: 0x45656f, roughness: .19, metalness: .6});
  const green = material({color: 0x247458, roughness: .78});
  const pale = material({color: 0xe3e4de, roughness: .88});
  const batches = new Map();
  const mattePrisms = material({vertexColors: true, roughness: .91});
  const glassPrisms = material({vertexColors: true, roughness: .19, metalness: .64});
  const putBox = (mat, position, dimensions, heading = 0, cast = true) => {
    box(mat, position, dimensions, heading, cast); stats.detailBoxes++;
  };
  function prism(points, bottom, height, wallColor, roofColor = wallColor, response = 'matte') {
    const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const key = `${response}:${Math.floor(center.x / 300)}:${Math.floor(center.z / 300)}`;
    if (!batches.has(key)) batches.set(key, {response, geometries: []});
    batches.get(key).geometries.push(polygonGeometry(points, bottom, height, wallColor, roofColor));
  }
  function clearance(points, padding = 3) {
    const bounds = new THREE.Box3().setFromPoints(points);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    sceneryClearances.push({center, heading: 0, width: size.x + padding * 2, length: size.z + padding * 2});
  }
  function edgeBox(a, b, y, height, thickness, mat, offset = 0, winding = 1) {
    const delta = b.clone().sub(a), length = delta.length();
    if (length < .1) return;
    const outward = new THREE.Vector3(delta.z, 0, -delta.x).multiplyScalar(winding / length);
    const position = a.clone().lerp(b, .5).addScaledVector(outward, offset); position.y = y;
    putBox(mat, position, [length, height, thickness], Math.atan2(-delta.z, delta.x));
  }
  function perimeter(points, y, height, thickness, mat) {
    for (let i = 0; i < points.length; i++) edgeBox(points[i], points[(i + 1) % points.length], y, height, thickness, mat);
  }
  function metadata(feature, points) {
    const bounds = new THREE.Box3().setFromPoints(points);
    const center = feature.point ? projectMonzaCoordinate(track, feature.point) : bounds.getCenter(new THREE.Vector3());
    const near = track.nearest(center.x, center.z);
    // Sample edges too: checking only polygon vertices can miss a narrow road.
    let pavedClearance = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 3));
      for (let k = 0; k <= steps; k++) {
        const p = a.clone().lerp(b, k / steps), nearest = track.nearest(p.x, p.z);
        pavedClearance = Math.min(pavedClearance, Math.abs(nearest.lateral) - 7.4);
      }
    }
    return {id: feature.id, name: feature.name, role: feature.role, sourceUrl: feature.osm?.url,
      center: center.toArray(), trackDistance: near.distance, lateral: near.lateral,
      minimumPavedClearance: pavedClearance, height: feature.height, heading: near.heading,
      authoredWidth: feature.width ?? null, authoredDepth: feature.depth ?? null,
      coordinates: feature.point ?? null,
      placement: feature.point ? 'mapped point; authored footprint' : 'mapped footprint'};
  }
  function building(feature, points) {
    const height = feature.height;
    const medical = feature.role === 'medical-centre';
    const historic = feature.role === 'historic-garages';
    const exhibition = feature.role === 'exhibition-hall';
    const workshop = historic || feature.role === 'paddock-workshops';
    const winding = Math.sign(ringArea(points));
    const wallColor = medical ? 0xe3e4de : historic ? 0xcabda5 : exhibition ? 0xc1c0b7 : 0xc7c5bb;
    prism(points, BASE, height, wallColor, historic ? 0x72766e : 0x656e70);
    perimeter(points, height + BASE + .12, .24, .20, historic ? cream : concrete);
    perimeter(points, .18, .24, .16, concrete);
    if (medical) perimeter(points, height - .38, .20, .12, green);

    const bounds = new THREE.Box3().setFromPoints(points), center = bounds.getCenter(new THREE.Vector3());
    // Door/window rhythm is an authored facade treatment, not surveyed bays.
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const delta = b.clone().sub(a), length = delta.length();
      if (length < 5) continue;
      const heading = Math.atan2(-delta.z, delta.x);
      const outward = new THREE.Vector3(delta.z, 0, -delta.x).multiplyScalar(winding / length);
      const bayCount = Math.max(1, Math.floor(length / (workshop ? 5.6 : exhibition ? 6.4 : 4.5)));
      const bayWidth = Math.min(workshop ? 3.8 : 2.4, length / bayCount - 1.2);
      for (let j = 0; j < bayCount; j++) {
        const p = a.clone().lerp(b, (j + .5) / bayCount).addScaledVector(outward, .04);
        const isDoor = workshop || (j === Math.floor(bayCount / 2) && i % 2 === 0);
        const panelHeight = isDoor ? Math.min(3.1, height - .65) : 1.25;
        p.y = isDoor ? BASE + panelHeight / 2 : Math.min(height - .8, 2.1);
        putBox(isDoor && workshop ? dark : glazing, p, [bayWidth, panelHeight, .07], heading, false);
        if (isDoor && workshop) {
          // Recessed garage doors, pale jambs and separate lintels.
          for (const side of [-1, 1]) {
            const jamb = p.clone().addScaledVector(delta, side * (bayWidth / 2 + .16) / length);
            jamb.y = (panelHeight + .2) / 2;
            putBox(cream, jamb, [.23, panelHeight + .2, .21], heading);
          }
          const lintel = p.clone(); lintel.y = panelHeight + .14;
          putBox(cream, lintel, [bayWidth + .5, .25, .27], heading);
        } else {
          const divider = p.clone(); putBox(silver, divider, [.055, panelHeight, .095], heading, false);
          const sill = p.clone(); sill.y -= panelHeight / 2;
          putBox(pale, sill, [bayWidth + .15, .09, .16], heading, false);
        }
      }
      // Continuous gutter and end downpipe provide depth without extra meshes.
      edgeBox(a, b, height - .1, .13, .16, silver, .11, winding);
      const pipe = a.clone().lerp(b, .025).addScaledVector(outward, .15); pipe.y = height / 2;
      putBox(silver, pipe, [.09, height - .12, .09], heading, false);
    }
    if (medical) {
      // A modest roof plant enclosure. No invented medical equipment/vehicles.
      center.y = height + .48;
      putBox(concrete, center, [3.8, .85, 2.2], track.nearest(center.x, center.z).heading);
    }
    clearance(points);
    stats.mappedBuildings++;
  }

  function tower(feature) {
    const center = projectMonzaCoordinate(track, feature.point);
    const near = track.nearest(center.x, center.z), heading = near.heading;
    const width = feature.width, depth = feature.depth, height = feature.height;
    const s = Math.sin(heading), c = Math.cos(heading);
    const local = (x, y, z) => new THREE.Vector3(center.x + x * c + z * s, y, center.z - x * s + z * c);
    // OSM marks a point only. This rounded frontage is authored from the
    // operator's tower photograph, facing the track on the outside of the lap.
    const points = [local(-width / 2, 0, -depth / 2), local(0, 0, -depth / 2)];
    for (let i = 1; i <= 16; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 16;
      points.push(local(Math.cos(a) * width / 2, 0, Math.sin(a) * depth / 2));
    }
    points.push(local(-width / 2, 0, depth / 2));
    const info = metadata(feature, points);
    if (info.minimumPavedClearance < .15) {stats.skipped.push({...info, reason: 'insufficient road clearance'}); return;}
    const base = height * .255, band = height * .055, upper = height * .81;
    prism(points, base, band, 0x85959b);
    prism(points, base + band, upper - base - band, 0x39616d, 0x56666b, 'glass');
    prism(points, upper, .9, 0xb5bec0);
    prism(points, upper + .9, height - upper - 1.15, 0x567c87, 0x667a80, 'glass');
    prism(points, height - .25, .25, 0x8c999e);
    for (const x of [-width * .32, width * .23]) for (const z of [-depth * .34, depth * .34]) {
      putBox(concrete, local(x, base / 2, z), [.45, base, .45], heading);
    }
    // Narrow metal mullions trace the curved glazing rather than boxing it in.
    for (const p of points) {
      const pos = p.clone(); pos.y = (base + band + upper) / 2;
      putBox(silver, pos, [.075, upper - base - band, .075], heading, false);
      const top = p.clone(); top.y = (upper + .9 + height - .25) / 2;
      putBox(silver, top, [.10, height - upper - 1.15, .10], heading, false);
    }
    for (const y of [base + band, base + (upper - base) * .5, upper]) perimeter(points, y, .10, .08, silver);
    // External access stair on the park side, away from the track envelope.
    const stairX = -width / 2 - 1.2, stairLength = 8.2, steps = 19;
    for (let i = 0; i < steps; i++) {
      const y = (i + 1) * base / steps;
      putBox(concrete, local(stairX, y / 2, -stairLength / 2 + (i + .5) * stairLength / steps),
        [1.75, y, stairLength / steps], heading);
      if (i % 3 === 0) for (const side of [-1, 1]) {
        putBox(silver, local(stairX + side * .82, y + .5, -stairLength / 2 + (i + .5) * stairLength / steps), [.055, 1, .055], heading, false);
      }
    }
    const allPoints = [...points, local(stairX - 1, 0, -stairLength / 2), local(stairX - 1, 0, stairLength / 2)];
    clearance(allPoints, 4);
    stats.features.push(info); stats.mappedTowers++;
  }

  for (const feature of referenceData.features) {
    if (!feature.rendered || feature.renderer !== 'landmark') continue;
    if (feature.role === 'hospitality-tower' && feature.point) {tower(feature); continue;}
    if (!Array.isArray(feature.footprint) || feature.footprint.length < 4 || !(feature.height > 0)) continue;
    const points = openRing(feature.footprint.map(point => projectMonzaCoordinate(track, point)));
    const info = metadata(feature, points);
    if (info.minimumPavedClearance < 2) {stats.skipped.push({...info, reason: 'insufficient road clearance'}); continue;}
    building(feature, points); stats.features.push(info);
  }
  for (const [key, batch] of batches) {
    const geometry = mergeGeometries(batch.geometries, false);
    for (const part of batch.geometries) part.dispose();
    if (!geometry) continue;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const object = mesh(geometry, batch.response === 'glass' ? glassPrisms : mattePrisms, true, true);
    object.name = `Mapped Monza landmarks · ${key}`;
    object.userData.provenance = stats.source;
    stats.meshBatches++; stats.extrusionTriangles += geometry.attributes.position.count / 3;
  }
  stats.triangles = stats.extrusionTriangles + stats.detailBoxes * 12;
  root.userData.monzaLandmarks = stats;
  return stats;
}
