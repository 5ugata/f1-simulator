# Asset provenance

Every runtime asset is stored in this project. No runtime API key, remote map service or external font server is required.

## Public source assets

| Local asset | Source | Terms / attribution |
| --- | --- | --- |
| `public/models/mclaren-mcl35m/` | [F1 2021 McLaren MCL35M by Excalibur](https://sketchfab.com/3d-models/f1-2021-mclaren-mcl35m-967ecec37468412083c40c62b3d7234d) | CC BY 4.0. Official user-supplied glTF, all 102,081 triangles and seven original PNGs retained. Original notice: `license.txt`; coordinate/rig changes and dimensions: `metadata.json` and `docs/CAR.md`. |
| `public/data/monza.geojson` | [Tomislav Bacinger — F1 circuits](https://github.com/bacinger/f1-circuits/blob/master/circuits/it-1922.geojson) | MIT, copyright 2019–2025 Tomislav Bacinger. Full notice: `public/data/f1-circuits-LICENSE.md`. |
| `public/data/monza-osm-way-*.json`, `monza-banking-bridge.json` | [OpenStreetMap bridge way](https://www.openstreetmap.org/way/34404729) and [covered-track way](https://www.openstreetmap.org/way/1443867793) | © OpenStreetMap contributors, ODbL 1.0. Two unchanged API extracts and adapted crossing/bearing metadata, downloaded/derived 29 September 2026. Notice: `public/data/openstreetmap-NOTICE.md`; derivation and accuracy limits: `docs/TRACK.md`. |
| `public/data/monza-osm-paddock.json`, `monza-landmarks.json` | [OpenStreetMap paddock extract](https://api.openstreetmap.org/api/0.6/map.json?bbox=9.279,45.613,9.286,45.622) | © OpenStreetMap contributors, ODbL 1.0. Unchanged API response and 16 selected building footprints plus two tower points, downloaded/derived 3 October 2026. Notice: `public/data/monza-landmarks-NOTICE.md`; architecture and placement: `docs/references/pit-complex.md` and `monza-landmarks.md`. |
| `public/textures/race-asphalt-clean-v1-*.jpg` | [Clean Asphalt — Poly Haven](https://polyhaven.com/a/clean_asphalt) | CC0; Dimitrios Savva. Unmodified 1K diffuse, OpenGL normal and roughness maps; 2.1 m scan scale. Active road/pit material. |
| `public/textures/asphalt-*.jpg` | [Asphalt 02 — Poly Haven](https://polyhaven.com/a/asphalt_02) | CC0; Rob Tuytel. Earlier 1K material retained, no longer used by the renderer. |
| `public/textures/grass-*.jpg` | [Aerial Grass Rock — Poly Haven](https://polyhaven.com/a/aerial_grass_rock) | CC0; Rob Tuytel. 1K diffuse and normal maps. |
| `public/textures/sky.hdr` | [Kloppenheim 06 Pure Sky — Poly Haven](https://polyhaven.com/a/kloppenheim_06_puresky) | CC0; Greg Zaal, Jarod Guest. 2K HDR. A lighting/sky reference, not a photograph taken at Monza. |
| `public/fonts/apex-0.ttf` through `apex-5.ttf` | [Barlow — Google Fonts](https://github.com/google/fonts/tree/main/ofl/barlow) | SIL Open Font License. Notice: `public/fonts/Barlow-LICENSE.txt`. |
| `public/fonts/apex-6.ttf` through `apex-9.ttf` | [Barlow Condensed — Google Fonts](https://github.com/google/fonts/tree/main/ofl/barlowcondensed) | SIL Open Font License. Notice: `public/fonts/BarlowCondensed-LICENSE.txt`. |
| `public/fonts/apex-10.ttf` through `apex-12.ttf` | [IBM Plex Mono — Google Fonts](https://github.com/google/fonts/tree/main/ofl/ibmplexmono) | SIL Open Font License. Notice: `public/fonts/IBMPlexMono-LICENSE.txt`. |

Circuit length, direction, turn count, naming and width references: [Autodromo Nazionale Monza's official circuit description](https://www.monzanet.it/en/circuit/). Source access began 27 September 2026.

[Pirelli's September 2024 surface report](https://press.pirelli.com/monza-welcomes-the-gtwc-with-a-new-track-surface-and-increased-grip/) describes complete resurfacing and a smoother, darker road. Clean Asphalt was selected to reflect that broad appearance; it is a generic material scan, not a photograph or material measurement taken at Monza. [Poly Haven's license](https://polyhaven.com/license) covers these downloaded maps under CC0.

The [operator's 2025 grandstand map](https://www.monzanet.it/wp-content/uploads/2025/03/GP_F1_2025_LISTINO_PREZZI_02_25.pdf) informs the inside/right placement of the Roggia grandstand. Grandstand dimensions and exact placement remain authored. The map itself is not bundled. FIA timing and DRS references are documented in `docs/TRACK.md`.

The bridge-reference data is offered locally under `/data/monza-banking-bridge.json`, with both original OSM extracts in the same directory. It controls only the north banking bridge's horizontal position and orientation; the authored bridge mesh and the separate MIT circuit dataset retain their own provenance. [OpenStreetMap's copyright page](https://www.openstreetmap.org/copyright) describes the data attribution and license.

Contributed Google Maps panoramas captured in 2022–2023 and the official Monza hospitality brochure inform the new pit facades and starting gantry. The tower and track-detail notes also record inspected operator photographs and 2024 kerb references. These images are reference-only, stored outside shipped assets; no Google panorama, Earth mesh or reference photograph is used as a runtime texture. Heights, facade modules, lamp diode patterns and fence meshes are authored in code. Exact links and dating limits are in [pit-complex](references/pit-complex.md), [landmark](references/monza-landmarks.md), [start-light](references/start-lights.md) and [track-detail](references/track-details.md) reference notes.

## Generated foliage

**Final project path:** `public/textures/park-oak-v1.png`.

Generated on 28 September 2026 with the built-in image-generation tool through the imagegen skill. It is a 1,254 × 1,254 RGBA PNG with preserved transparent alpha, copied unchanged into the project. The tree is illustrative; it does not represent a surveyed individual tree at the real circuit. The original procedural foliage remains the load-failure fallback. The McLaren is imported glTF geometry; the track and buildings are native Three.js geometry.

Final prompt:

> Use case: photorealistic-natural. Asset type: transparent cutout tree billboard texture for a physically rendered Monza racing simulator. Generate ONE photorealistic mature European pedunculate oak tree, full tree from trunk base to highest leaf, isolated on an ACTUAL TRANSPARENT BACKGROUND with a true alpha channel. The tree is a natural northern Italian park oak in late summer, 22 metres tall, broad irregular leafy green crown, delicate organic leafy silhouette with many tiny transparent gaps showing between leaves and branches, visible dark brown branching trunk in the lower third. The entire tree must fit in a square image with 4 percent transparent margin all around, trunk base centered horizontally at bottom. Straight-on eye-level long lens photograph, minimal perspective, no cast shadow, no ground, no grass, no horizon, no background scenery, no white backdrop, no checkerboard pixels, no labels or watermark. Natural muted olive/dark green leaves with subtle warm sun at upper left, realistic deep internal leaf shadows but balanced diffuse light so useful as a game texture from multiple angles. Extraordinary botanical detail and photographic realism, not an illustration, not a sphere canopy, not stylized, not a 3D low-poly render. Square 1536x1536 or best available resolution. Save as PNG preserving transparent alpha.

## Generated spectators

**Final project path:** `public/textures/spectators-atlas-v1.png`.

Generated on 28 September 2026 with the built-in image-generation tool through the imagegen skill. The original 1,536 × 1,024 RGBA PNG is preserved unchanged. Eight fictional seated adult spectators occupy a four-column, two-row transparent atlas; these are illustrative people, not photographs of actual Monza attendees. The grandstand uses instanced cards with one selected portrait per seat. The procedural crowd remains the asset-load fallback.

Final prompt:

> Use case: photorealistic-natural. Asset type: game spectator texture atlas for a Monza motorsport simulator. Create an image 1536 wide by 1024 high, precisely divided into FOUR EQUAL COLUMNS and TWO EQUAL ROWS, eight equal portrait cells, with NO visible grid or borders. In EACH cell, place ONE different anonymous adult motorsport spectator, front-facing, sitting on an invisible bleacher seat, visible from top of head down to knees. Every person fully contained in their own cell with transparent padding on all sides, top of head at 10% of cell height and knees at 90%. Actual transparent RGBA background in every cell, no backdrop pixels, no checkerboard, no ground and no chair. Eight distinct naturally posed spectators: varied men and women aged 25 to 60, varied European/Mediterranean skin tones and faces, believable photographic proportions, casually looking toward a race track, arms loosely resting on knees or folded. Practical casual clothing in muted burgundy, navy, gray, cream, olive; a few plain baseball caps and sunglasses. Subtle varied emotion and natural posture, all remain seated. Soft outdoor daylight from upper left, real fabric texture, detailed natural faces and hair, lifelike body shading. This is a realistic photographic asset, not stylized, not cartoon, not plastic 3D models. No logos, text, branding, watermarks, overlapping between cells, or extra people. Precise eight-cell composition and transparent surroundings are essential because the game selects each portrait with fixed texture coordinates.

## Authored assets and software

The original APEX identity, procedural environment geometry, fallback crowd meshes, signs, markings, texture fallbacks, effects and synthesized audio are authored in this project. Geographic building references have the separate ODbL provenance above. The active McLaren car and livery are Excalibur's imported CC BY 4.0 model, credited in the simulator and its bundled license; they are not original project artwork. Engine and tyre sounds are synthesized, with no recorded team audio bundled.

Three.js supplies rendering primitives and its example postprocessing/sky/loaders under the Three.js MIT license. Its full notice is included in `public/licenses/three-LICENSE.txt` and ships with the built site. Vite and Playwright are development/build/test dependencies; their upstream licenses remain in their npm packages.
