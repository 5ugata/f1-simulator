# McLaren MCL35M

The active car is **F1 2021 McLaren MCL35M by Excalibur**, the exact model requested by the user: [Sketchfab model 967ecec37468412083c40c62b3d7234d](https://sketchfab.com/3d-models/f1-2021-mclaren-mcl35m-967ecec37468412083c40c62b3d7234d). It depicts the 2021 Emilia Romagna / Imola livery. The same imported model appears in cockpit, pod, chase, nose, lobby and ghost views.

This work is based on “F1 2021 McLaren MCL35M” by [Excalibur](https://sketchfab.com/excalibur), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original download notice is preserved in `public/models/mclaren-mcl35m/license.txt`, with visible credit in the circuit panel and lobby car label. This project is not affiliated with McLaren or Formula 1.

## Source and conversion

The user supplied both the original OBJ archive and the official glTF archive. The glTF is the production source because it includes the creator's Sketchfab material setup. `scripts/convert-mclaren.mjs` converts `imports/mclaren-gltf/scene.gltf` into `public/models/mclaren-mcl35m/mcl35m.gltf`, its binary buffer and metadata. Raw downloads remain separate from production assets.

- All **102,081 triangles** are retained; there is no decimation or replacement bodywork.
- All seven original PNG texture files are copied byte-for-byte. Original UVs, normals and PBR material parameters are retained.
- A rigid Y half-turn establishes glTF +Y-up / −Z-forward coordinates. Uniform scaling sets the total mesh width to 2 m; proportions remain unchanged.
- Translation places the lowest geometry on the ground and the simulation origin between the axles, with a 55% front / 45% rear lever-arm split.
- Existing triangles using wheel/rim materials are partitioned among four wheel assemblies. The steering-wheel material forms a separate animated assembly. The remainder stays in the body.

The source has no driver figure. Its cockpit, halo and steering wheel are rendered directly. Steering and wheel rotation animate; the source rear wing currently remains geometrically static even when the authored physics enables DRS. Live rear-view mirror rendering is disabled at the user's request. Physical mirror housings remain part of the source mesh.

## Measured imported geometry

| Measurement | Value |
| --- | ---: |
| Full mesh triangles | 102,081 |
| Width | 2.000 m |
| Length | 5.570 m |
| Height | 1.169 m |
| Wheelbase | 3.625 m |
| Front / rear axle about simulation origin | +1.994 / −1.631 m |
| Rear rolling radius | 0.3276 m |
| Front / rear track | 1.617 / 1.571 m |
| Front / rear tyre mesh width | 0.368 / 0.426 m |
| Front / rear collision extent | 3.195 / 2.376 m |

These are measurements of the normalized artist-made mesh, not a manufacturer dimensional survey. Small source asymmetries are preserved. Exact values, source attribution and conversion operations are in `metadata.json`.

`VehiclePhysics` receives these axle, wheel and collision dimensions. Its aero, engine, tyre-force and energy coefficients remain an authored hybrid model; importing an accurate-looking car does not establish validated MCL35M handling. See [PHYSICS.md](./PHYSICS.md).

## Runtime and cameras

`loadMclarenCar()` in `src/mclaren-car.js` loads the local asset once and returns a factory for the player and ghost. Clones share source geometry/textures; the ghost receives separate translucent materials. Wheel and steering pivots preserve imported transforms before animation. The adapter supplies `group`, `update`, `dimensions`, camera descriptors, `setCockpit`, `dispose`, and source metadata.

A nested Z reflection converts the source's −Z-forward coordinates into the simulation's +Z-forward frame. The existing reflected world root cancels it for rendering, preserving the original livery's handedness and readable lettering without editing UVs. Camera descriptors remain in simulation coordinates. `src/cameras.js` consumes model-supplied cockpit, pod, chase, nose and lobby positions/targets/FOVs.

Rear tyre marks and particles use the imported rear axle and track width and independently sample each contact's surface. Body roll lowers the outside during turns; acceleration raises the nose and braking lowers it. This motion is cosmetic, not a full suspension solver.

## Sound and legacy geometry

`src/audio.js` retains its procedural Web Audio engine, turbo, shift, wind, tyre, kerb and loose-surface sound. It is not a recording of the 2021 Mercedes power unit. Audio starts from a user gesture and requires no microphone or network service.

The earlier fictional AP-25 builder remains in `src/car.js` for default-geometry regression tests. The application does not instantiate it for driving or the ghost.
