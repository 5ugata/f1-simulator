# Monza garage, hospitality building and podium

`src/pit-complex.js` reconstructs the separate Palazzina Box, Hospitality Building and circular podium. Horizontal placement uses OpenStreetMap; facade treatments use inspected photographs. This is an authored reconstruction, not surveyed architecture or extracted Google Earth geometry.

## Map data and derived extents

The source is the unchanged [OpenStreetMap paddock extract](https://api.openstreetmap.org/api/0.6/map.json?bbox=9.279,45.613,9.286,45.622), downloaded 3 October 2026 to `public/data/monza-osm-paddock.json`. Selected coordinates and source versions are preserved in `public/data/monza-landmarks.json`. © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); see `public/data/monza-landmarks-NOTICE.md`.

| Structure | Source | Derived width × length | Along-axis bearing | Geographic track station / lateral |
| --- | --- | --- | --- | --- |
| Palazzina Box | [Way 34404652](https://www.openstreetmap.org/way/34404652), v7 | 25.29 × 230.44 m | 6.0448° | 5605.91 m / +38.15 m |
| Hospitality Building | [Way 194458105](https://www.openstreetmap.org/way/194458105), v5 | 29.22 × 90.41 m | 5.3855° | 5780.72 m / +34.14 m |
| Podio | [Way 219396377](https://www.openstreetmap.org/way/219396377), v3 | 10.85 × 10.85 m | 5.9324° | 5516.41 m / +12.50 m |

Bearings run clockwise from north in simulation coordinates. Building axes follow their longest mapped edge; the circular podium uses the nearby track tangent. These figures are enclosing oriented-box extents after applying the same projection and uniform length scale as the road. The facade meshes interpret those boxes; they do not reproduce every exterior polygon segment. The round podium is approximated by a circle derived from its mapped extent. Community mapping accuracy is not survey accuracy.

## Inspected photographic references

- [Google Maps panorama, Roger Steinbrunner, September 2022](https://www.google.com/maps/@?api=1&map_action=pano&pano=CIHM0ogKEICAgICe2v6NtAE&heading=80&pitch=-6&fov=80), near 45.6189783° N, 9.2811925° E: separate hospitality block, open balcony levels, blue seating and projecting roof structure.
- [Google Maps panorama, Jaihabehygreck, captured July 2023](https://www.google.com/maps/@?api=1&map_action=pano&pano=CIHM0ogKEICAgID1yLSOQw&heading=85&pitch=-6&fov=80), near 45.6177315° N, 9.2812282° E: garage frontage, recessed lower bays, upper glazing and horizontal metal bands. The contributor label shows January 2024; the imagery capture label is July 2023.
- [Google Maps panorama, Jaihabehygreck, December 2023](https://www.google.com/maps/@?api=1&map_action=pano&pano=CIHM0ogKEICAgIC11NXIQg&heading=65&pitch=-6&fov=80), near 45.6171609° N, 9.2812138° E: additional garage frontage, shutters and upper facade detail. This view does not establish podium dimensions.
- [Official Monza 2026 hospitality brochure, page 8](https://www.monzanet.it/wp-content/uploads/2025/11/Brochure_Hospitality_GPf12026.pdf#page=8): rounded hospitality facade, blue balcony seating and projecting roof; the pictured event is from 2021. Brochure publication year does not date every photograph in it.

The Google views are contributed panoramas inspected in the Maps viewer, not official Google camera-car coverage or a downloaded Earth mesh. Reference screenshots, saved viewer text and the brochure remain in ignored development artifacts. None is shipped as a runtime texture. Modeled signs and materials are produced in code.

## Authored geometry

The garage has 50 visual bay modules, computed from its mapped length and an authored approximately 4.6 m spacing. Roller-shutter lintels, recessed doors, upper glazing, roof ribs and equipment are visual interpretations. These are not an inventory of operational Monza garages. The roof slab is at approximately 9.46 m, with ribs around 10.42 m.

The hospitality building has balcony levels at 1.15, 4.85 and 8.55 m, blue seating, rails, a projecting canopy and a rounded southern lounge. The current mesh generates 855 seat instances; this is not a real capacity claim. The core is 13 m tall and the rounded facade uses a 10.5 m radius. Its center lies one radius inside the southern mapped bound, while the shortened straight block occupies the remaining length. Thin lips and canopies have authored overhangs beyond the basic envelope.

The podium has a roughly 5.43 m radius, its main platform at 5.74 m and canopy at 9.08 m. A roughly 13.01 m bridge connects toward the garage frontage. Heights, railings, supports, signage, stairs, materials and facade rhythms are authored; the OSM data supplies none of those measurements.

Repeated details use the world's shared spatial box batches. Curved facades, podium disks and rails use small dedicated meshes. All geometry remains beneath the reflected world root, and sign textures use the same lettering correction as other scenery. Building bounds exclude trees before forest generation. Materials, generated textures and meshes use the world's existing disposal path.

`world.pitComplex` exposes source IDs, derived extents, positions and generated bay/seat counts. `npm run test:track` checks these objects in the production scene and captures reference views. The model combines dated visual references with community footprints; it does not claim to reproduce the 2026–2027 redevelopment or temporary Grand Prix installations.
