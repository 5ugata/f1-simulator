# Monza circuit and environment

The road centerline uses real geographic coordinates for Autodromo Nazionale Monza, Italy. It is a geographically grounded reconstruction, **not a laser-scanned or officially licensed circuit**.

## Sources and rights

- Geographic data: [Tomislav Bacinger, f1-circuits / it-1922.geojson](https://github.com/bacinger/f1-circuits/blob/master/circuits/it-1922.geojson), downloaded 27 September 2026. Copyright 2019–2025 Tomislav Bacinger; MIT license is preserved in `public/data/f1-circuits-LICENSE.md`. The original, unmodified GeoJSON is `public/data/monza.geojson`.
- Official reference: [Autodromo Nazionale Monza, circuit layout](https://www.monzanet.it/en/circuit/), consulted 27 September 2026. The operator publishes a 5,793 m clockwise circuit, width 10–12 m, and seven right / four left turns. This reference also informed the corner names and wooded, high-speed circuit character.
- Historic banking bridge position and bearing: [OpenStreetMap way 34404729](https://www.openstreetmap.org/way/34404729) and [covered-track way 1443867793](https://www.openstreetmap.org/way/1443867793), downloaded 29 September 2026. © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Original extracts, adapted reference data and a notice are supplied in `public/data/`; see the bridge section below. This separate reference does not replace or modify the MIT road centerline.
- Pit and service-building footprints and two tower points: [OpenStreetMap paddock extract](https://api.openstreetmap.org/api/0.6/map.json?bbox=9.279,45.613,9.286,45.622), downloaded 3 October 2026. The unchanged response, derived `monza-landmarks.json` and separate ODbL notice are in `public/data/`. [Pit references](references/pit-complex.md) and [landmark references](references/monza-landmarks.md) distinguish mapped placement from authored architecture.
- PBR asphalt: [Clean Asphalt by Dimitrios Savva / Poly Haven](https://polyhaven.com/a/clean_asphalt), CC0. Local 1K diffuse, OpenGL normal and roughness maps, tiled at the source's 2.1 m physical scale. This generic scan represents the smoother, darker appearance described in [Pirelli's report on Monza's 2024 resurfacing](https://press.pirelli.com/monza-welcomes-the-gtwc-with-a-new-track-surface-and-increased-grip/); it is not a Monza surface scan.
- PBR park ground: [Aerial Grass Rock by Rob Tuytel / Poly Haven](https://polyhaven.com/a/aerial_grass_rock), CC0. Local 1K diffuse and OpenGL normal maps.
- All authored procedural fallback foliage, buildings, banners, markings, fencing and gravel textures are original project code. The primary oak texture is generated artwork documented in `docs/ASSETS.md`. Environment sky provenance is documented separately by the renderer/assets documentation.

## Geographic construction

1. Longitude and latitude are converted to local metres using an equirectangular projection at the first source point, approximately 45.618975° N, 9.281223° E. +X is east and +Z is north.
2. Source segments are densified to at most 10 m. A closed centripetal Catmull–Rom curve rounds the source's discrete polyline corners while retaining the long straights.
3. The smoothed curve is uniformly scaled by approximately 1.000895, changing its measured 5,787.82 m perimeter to the operator's published 5,793 m.
4. The circuit is resampled to 2,896 equally spaced points, approximately 2 m apart. Its origin is the source dataset's starting-line point; travel follows its clockwise coordinate order. The render scene reflects Z into Three.js camera space; simulation and map coordinates retain +X east / +Z north.
5. A spatial grid accelerates nearest-segment lookup. Sampling returns position, tangent, right vector, heading, signed curvature, width and modeled barrier clearances. A coarse global fallback handles positions well outside the circuit.

## Pit complex and mapped landmarks

The garage block, separate hospitality building and circular podium use OSM footprints. Their derived oriented extents are approximately 25.29 × 230.44 m, 29.22 × 90.41 m and 10.85 × 10.85 m respectively. The main blocks interpret these extents; they are not exact polygon extrusions. Contributed Google Maps panoramas captured in 2022–2023 and the operator's brochure inform glazing, open balconies, blue seating, garage recesses, roof framing and the rounded lounge. Heights and facade details remain authored. The [pit reference note](references/pit-complex.md) records exact source links, dates, bearings and dimensions.

Twelve additional buildings retain their mapped polygon footprints, including Vecchie rimesse, Padiglione Esposizioni and Centro Medico. Torre Nord and Torre Sud retain mapped point locations and use photo-informed rounded glass architecture with authored 6.0 × 7.2 m envelopes and 16.8 m height. [Landmark provenance](references/monza-landmarks.md) includes each source object and the geometry limits.

The outside barrier follows the same visual and physics profile around both tower bases: approximately 11.86 m from the centerline at Torre Nord and 7.99 m at Torre Sud, with short smooth transitions. These clearances follow the authored tower envelopes and are not measured real barrier positions. Road width, geographic origin and timing gates are unchanged. Google imagery is reference-only; no panorama or Earth geometry is bundled at runtime.

## Historic north banking bridge

The [operator's circuit description](https://www.monzanet.it/en/circuit/) identifies the Serraglio straight's underpass beneath the north banking. Two OpenStreetMap segments independently locate the crossing: way 34404729 is tagged as a concrete historic elevated raceway, and way 1443867793 is the covered asphalt Grand Prix segment below it.

Intersecting their projected centerlines gives approximately **45.6247704° N, 9.2892512° E**, nearest to geographic track distance **3,293.06 m**. The reconstructed Grand Prix centerline passes within about 0.08 m of that intersection. The elevated segment runs on a bearing of approximately **139.76° clockwise from north**, producing a crossing angle of about 88.95° with the local circuit direction. The bridge now uses this map position and bearing instead of its former authored 3,170 m station. This numerical agreement is between map datasets and does not establish survey accuracy.

The raw API responses are preserved unchanged as `public/data/monza-osm-way-34404729.json` and `public/data/monza-osm-way-1443867793.json`. The first way is version 9 and its endpoint coordinates date to 2010; the second is version 1 from 2025. The bridge way also retains a `note=draft` tag. `public/data/monza-banking-bridge.json` records the adapted crossing coordinate, bearing, source versions and derivation under ODbL 1.0, with attribution in `public/data/openstreetmap-NOTICE.md`. The world loads this small local reference alongside its textures; it omits the bridge if that optional file is unavailable.

Only placement and orientation use this data. The existing five-box bridge mesh remains an authored approximation: deck size 57 × 11 m, underside 7.25 m above the level circuit, approximate concrete supports and parapets. Those dimensions, bank angle, surrounding embankments and the real underpass's vertical road profile are not measured by the source ways. The forest generator leaves clearance around the modeled deck. There is no full historic oval or laser-scanned bridge geometry.

## Start grid, control line and 2025 timing reference

Monza has separate start and control/finish lines. The [FIA competition visa, page 4](https://www.fia.com/system/files/decision-document/2026_italian_grand_prix_-_competition_visa.pdf) publishes a 309 m start-line offset and a 5,484 m first lap. This also agrees with the [official 2025 race information](https://www.formula1.com/en/racing/2025/italy): `53 × 5,793 − 306,720 = 309 m`. The source polyline's origin remains at the start grid; the modeled control line is therefore at geographic track distance `5793 − 309 = 5484 m`.

This placement is an inference from the published offset and our mapped starting point, not a surveyed finish-line coordinate. Applying it to the existing centerline gives approximately 45.616215° N, 9.280790° E. Neither the geographic projection nor scenery distances are shifted.

The [FIA 2025 Italian Grand Prix circuit map, page 2](https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exit_map_quarantine_zone_and_red_zones.pdf) specifies sector splits 233 m before Turn 4 and 215 m before Turn 8, and DRS activation 12 m after the finish line and 170 m after Turn 7. Applying those offsets to this reconstruction gives:

| Feature | Geographic track distance | Distance from the control line |
| --- | ---: | ---: |
| Start grid | 0 m | 309 m |
| Control/finish line | 5,484 m | 0 m |
| Sector 1 | about 1,603.92 m | about 1,912.92 m |
| Sector 2 | about 3,439.26 m | about 3,748.26 m |
| Main-straight DRS activation | 5,496 m | 12 m |
| Serraglio DRS activation | about 2,747.44 m | about 3,056.44 m |

The corner-relative positions inherit the mapped corner references' approximation. The FIA map does not publish numerical DRS deactivation coordinates. Our zones end at authored braking gates 170 m before Turn 1 and 180 m before Turn 8; those endpoints and resulting lengths are gameplay choices. Main-straight DRS remains available across the geographic distance-zero seam. This is a 2025-style DRS reference, not the 2026 active-aero rules or a simulation of race eligibility/detection gaps.

Sessions launched from the grid begin on an out lap. The first forward control-line crossing starts the first complete timed lap; the opening partial run cannot become a personal best. See `docs/PHYSICS.md` for timing, recovery and ghost validation.

The starting signal is a left-supported cantilever with five columns of paired red lenses, replacing the former full-width arch. A contributed September 2022 panorama informs its silhouette; the 80 m station and structural dimensions are authored. The physical lights and HUD share a one-column-per-second sequence followed by simultaneous lights out after a variable hold. Input is released at lights out, and pausing freezes the sequence. [Signal references and limits](references/start-lights.md) cite the 2021 FIA standing-start procedure and distinguish it from the simulator's preparation/hold choices.

## Authored road-edge surfaces

Rendering and tyre contact share the same fourteen kerb intervals, seven gravel-trap intervals and lateral bands. A kerb exists only on the specified side of its corner interval; the straight paved apron does not produce kerb contact. All dimensions here describe the authored reconstruction rather than surveyed Monza edge geometry.

| Surface layer | Absolute distance from the centerline | Current dry contact type |
| --- | --- | --- |
| Main road | 0–6 m | Asphalt |
| Paved apron | 6–7.4 m, where not covered by a higher layer | Asphalt |
| Earthy shoulder | 7.3–8 m, where not covered by kerb or paint | Gravel |
| Corner kerb | 6.04–7.55 m, on its section and side | Kerb |
| Green paving behind a kerb | 7.55–8.8 m, on its section and side | Asphalt |
| Green paving before a gravel trap | 7.4–9.15 m, on its section and side | Asphalt |
| Broad gravel trap | 9 m to 3 m inside the barrier, with its inner edge covered by green paving | Gravel |
| Remaining ground | Outside those bands | Grass |

Contact follows the visible layer order. Raised kerbs cover lower apron, shoulder and runoff layers. Green paving covers the shoulder and the first 0.15 m of the broad gravel mesh; the uncovered shoulder covers the final 0.1 m of the asphalt base. Gravel does not extend beyond its visible trap into the park. Stepped kerb faces, slab seams and narrow orange chicane bevels remain visual detail within the existing kerb contact approximation. Paved runoff uses ordinary asphalt grip in the dry model; paint-specific friction is not simulated. Surface material does not change the separate track-limit checks.

The kerb appearance follows inspected August–September 2024 references. Seven sections receive inclined upper catch fencing, and six existing authored marshal-station areas receive unlit LED-panel geometry. Their locations are not a surveyed FIA light-panel layout. The new narrow gravel strips and real escape roads are not simulated; see [track-detail evidence and limits](references/track-details.md).

## Accuracy boundaries

- The public polyline is a map representation. It does not contain surveyed edge geometry, track camber, elevation, grip, drainage, kerb profiles or current construction work.
- The road is modeled level at 12 m width, the operator's published maximum. Actual width varies from 10 to 12 m. Neither the flat surface nor constant width should be mistaken for surveyed data.
- Kerbs and gravel are placed around the correct named corners. Their exact dimensions, contemporary configuration and friction are authored approximations.
- Pit/service footprints and tower points now use map data; their heights, materials and detailed architecture remain authored. Other barriers, fencing, grandstands and vegetation retain approximate placements. The historic banking bridge's position and bearing use map data, while its structure, dimensions and height remain authored. None is a building survey.
- Visual references span 2021–2024, supplemented by later map edits. The environment does not claim an exact single-season reconstruction or the 2026–2027 redevelopment.
- Timing splits and DRS activation use the published 2025 offsets above, applied to approximate map references. They are not surveyed FIA timing-loop coordinates or a reproduction of current race regulations; DRS braking gates remain authored.
- Source corner coordinates are projected onto the modeled centerline. Display names follow common usage, including Curva Grande and Parabolica; the official current names are Curva Biassono and Curva Alboreto respectively.

## Rendering and performance

Road surfaces use local photographic PBR maps, narrow physical markings, rubbed-in braking marks and raised kerb details. Trees combine a generated photographic alpha texture, crossed cards and separate trunks; procedural foliage remains a fallback. The texture prompt and provenance are in `docs/ASSETS.md`. Broad scenery is instanced by shared material; dense foliage does not create one draw call per tree. The lower quality setting reduces foliage density and shadows. No externally hosted asset is needed at runtime after the project dependencies are installed.

## Interface

`createTrack()` fetches local GeoJSON. `createTrackFromGeoJSON(data)` provides the same circuit without browser I/O for validation. `sample(distance)`, `nearest()`, corner distances, `sectors` and scenery use the unchanged geographic distance origin at the start grid. Heading follows `atan2(tangent.x, tangent.z)` and positive lateral distance is to the driver's right.

`startLineDistance` is 0 and `controlLineDistance` is 5484. `toLapDistance(geographicDistance)` converts to forward distance from the control line, wrapping into `[0, 5793)`. `fromLapDistance(lapDistance)` performs the inverse conversion. `lapSectors` supplies timing-relative splits for session gates and telemetry; `sectors` remains geographic for scene placement. `drsZones` contains `{name, start, end}` entries in geographic distance; an entry with `end < start` crosses the start-grid seam. `isDrsZone(distance)` includes activation and excludes the authored end gate.

`barrierLeft` and `barrierRight` are distances from the centerline, not edge clearances. `runoffLeft` and `runoffRight` represent the outer runoff extent. `surfaceAt(distance, lateral)` returns `asphalt`, `kerb`, `grass` or `gravel` for the modeled terrain, using geographic distance and signed lateral position.

`kerbSections` contains `{corner, start, end, side}` entries; `corner` is the displayed turn number, distances are geographic metres, and `side` is −1 for left or +1 for right. `runoffSections` retains `[start, end, side]` tuples for broad gravel traps and their green paving. `surfaceBands` supplies positive `{inner, outer}` lateral bounds for `apron`, `shoulder`, `kerb`, `kerbRunoff` and `runoffPaint`; `gravelTrap` supplies `inner` and `barrierClearance`. The world builder consumes those definitions directly. `tests/surfaces.test.mjs` checks contact on the straight apron, actual corner kerbs, painted runoff, finite gravel edges and through vehicle integration.

`createWorld(scene, track, options)` assembles scenery through `pit-complex.js`, `monza-landmarks.js`, `track-details.js` and `start-lights.js`, without changing the sky, lights, renderer or camera. It exposes their metadata as `pitComplex`, `landmarks`, `trackDetails` and `startSignal`; `update()` animates flags. Starting-light states are driven by the shared session sequence in `main.js`. The exposed golden, clear and overcast presets are all dry; neither rain nor wet-contact physics is simulated.

`npm run test:track` exercises the new structures and physical/HUD start sequence in the production preview, including pause/resume, lights-out release, and six diagnostic scenery views. `npm test` includes source-coordinate, clearance and lamp-sequence regressions.
