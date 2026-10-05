# Monza starting signal reference

The signal replaces the former invented full-width `MONZA` arch. It reconstructs the asymmetric, left-supported cantilever visible in a September 2022 track-level panorama. The simulator uses five independently controlled columns of paired red lenses, with black housings and upper sun hoods, below a dark information panel.

## Inspected visual evidence

- [Google Maps panorama by Roger Steinbrunner, September 2022](https://www.google.com/maps/@?api=1&map_action=pano&pano=CIHM0ogKEICAgICe2v6NtAE&heading=348&pitch=0&fov=85), near 45.6189783° N, 9.2811925° E. The screenshot inspected during development is `artifacts/references/google-streetview-monza.png`. It shows the signal ahead of the camera, its arm approaching from the left of the circuit, a wide dark panel and hanging lamp housings. This is a contributed Google Maps panorama, not imagery captured by an official Google Street View car.
- [Official Formula 1 2021 Italian Grand Prix race-start replay](https://www.formula1.com/en/video/2021-italian-grand-prix-watch-the-race-start-at-monza.1710701545711943514). The public preview image was inspected. It shows the cars accelerating down the straight, but does **not** show the gantry; it is not used as evidence for gantry dimensions or shape.

Reference images remain outside the shipped assets. No Google image, F1 photograph or panorama is used as a texture. The lamp diode pattern is generated in code.

## Sequence evidence and implementation

[FIA 2021 Formula One Sporting Regulations, issue 10, article 36.10, printed page 36](https://api.fia.com/sites/default/files/2021_formula_1_sporting_regulations_-_iss_10_-_2021-07-01.pdf) describes the five, four, three, two and one second light sequence followed by simultaneous extinction of all red lights to signal a standing start. The cited season matches the imported 2021 McLaren. Green is used elsewhere in real procedures, including the formation lap; it is not the race-start signal reproduced here.

`getStartSequence(elapsed, hold)` is a pure timing helper shared by the visible gantry and interface. After an authored 0.7-second preparation delay, one column illuminates at each of 0.7, 1.7, 2.7, 3.7 and 4.7 seconds. Both lenses in each column change together. `hold` specifies the delay after the fifth column; the helper default is 1.4 seconds. Every red then turns off together and `released` becomes true. The preparation delay and the application's choice of hold duration are simulation design choices, not claims about an FIA-mandated delay or a measured distribution. The simulator does not recreate the full formation-lap or aborted-start procedure.

## Geometry and limits

The panorama supports the structure's general arrangement. It does not provide a survey, reliable heights, engineering drawings or an exact along-track coordinate. The following dimensions are authored to fit the existing scene and reproduce the observed silhouette:

| Element | Modeled value |
| --- | --- |
| Station from the existing geographic origin | 80 m |
| Support center, relative to road center | 15.6 m left |
| Support height | 8.8 m |
| Cantilever end | 2.4 m right of road center |
| Lamp radius | 0.185 m |
| Column pitch | 0.71 m |
| Lamp center heights | 5.45 m and 5.98 m |
| Lowest road-overhanging housing edge | 5.06 m |

The station estimate places the signal ahead of the photographed origin; it must not be read as a relocation or measurement of the real start line. The module does not alter start/control timing gates. The left foundation remains outside the existing 14 m barrier offset. No support is placed in the road or the pitlane. Bracing, access ladder, tension members, cooling fins and electrical cabinet are authored construction details. The dark information panel is blank, and no temporary sponsor banner is invented.

All geometry remains under the simulator's reflected world root. The lamp faces point upstream in simulation coordinates. Five small instanced lens meshes allow independent red states; repeated hardware is batched, so the structure does not introduce a draw call for every brace, rung or lamp hood. The focused tests cover sequence boundaries, variable final hold, simultaneous extinction, ten paired lenses, upstream orientation and fixed geometry while states change.
