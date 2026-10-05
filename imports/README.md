# McLaren source assets

The converted production model is already included in `public/models/mclaren-mcl35m/`. A fresh clone can build and run without the original download.

This folder is only for optionally repeating the conversion from the creator’s glTF download; raw archives and extracted source files are ignored by Git.

The exact source is [F1 2021 McLaren MCL35M by Excalibur](https://sketchfab.com/3d-models/f1-2021-mclaren-mcl35m-967ecec37468412083c40c62b3d7234d), licensed under CC BY 4.0. The source archive's `license.txt` is preserved with the production model.

Extract the official glTF ZIP into `imports/mclaren-gltf/`, then run:

```sh
node scripts/inspect-gltf.mjs imports/mclaren-gltf/scene.gltf
node scripts/convert-mclaren.mjs
npm run build
```

The converter retains every source triangle and copies all seven PNGs without alteration. It normalizes coordinates and partitions the existing wheel and steering geometry for animation. Camera calibration is in `src/mclaren-car.js`; provenance and dimensional limits are documented in `docs/CAR.md`.
