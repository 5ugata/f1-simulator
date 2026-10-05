# Mapped Monza paddock and service structures

The environment adds twelve buildings on mapped footprints and the two mapped glass hospitality towers, Torre Nord and Torre Sud. Three named buildings are recognizable additions: the Vecchie rimesse, Padiglione Esposizioni and Centro Medico. The nine other footprints are commercial/service buildings in the paddock area; unknown uses are not assigned invented names.

## Geographic sources

The unchanged [OpenStreetMap API extract](https://api.openstreetmap.org/api/0.6/map.json?bbox=9.279,45.613,9.286,45.622) is saved as `public/data/monza-osm-paddock.json`, accessed 3 October 2026. © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The derived database is `public/data/monza-landmarks.json`, under the same license, and its notice is `public/data/monza-landmarks-NOTICE.md`.

For each selected building, the way's node coordinates are copied without simplification, recentering or alteration. The renderer uses the same equirectangular projection and small circuit-length scale as `track.js`: +X east, +Z north, with scene reflection applied by the parent world. Original source IDs, object versions, timestamps, tags and primary URLs remain in the data.

| Structure | Map source | Geometry evidenced by the source | Authored vertical dimensions |
| --- | --- | --- | --- |
| Vecchie rimesse | [Way 193647797](https://www.openstreetmap.org/way/193647797), v3 | Closed service-building footprint and name | 4.5 m main wall height |
| Padiglione Esposizioni | [Way 193647798](https://www.openstreetmap.org/way/193647798), v3 | Closed public-building footprint and name | 6.2 m main wall height |
| Centro Medico | [Way 194458108](https://www.openstreetmap.org/way/194458108), v4 | Closed hospital-building footprint, hospital use and name | 3.8 m main wall height |
| Torre Nord | [Node 2396630508](https://www.openstreetmap.org/node/2396630508), v1 | Point location and tower name | 16.8 m height; 6.0 × 7.2 m footprint envelope |
| Torre Sud | [Node 2396630532](https://www.openstreetmap.org/node/2396630532), v3 | Point location and tower name | 16.8 m height; 6.0 × 7.2 m footprint envelope |

The remaining mapped building ways are 193647799, 193647800, 194739930, 194739931, 194739932, 194739933, 194739934, 194739935 and 194751178. Their authored heights range from 3.0 to 4.2 m. The data also includes four `renderer: "pit-complex", rendered: false` records for the separate pit builder: [Palazzina Box, way 34404652](https://www.openstreetmap.org/way/34404652), [Hospitality Building, way 194458105](https://www.openstreetmap.org/way/194458105), [Podio, way 219396377](https://www.openstreetmap.org/way/219396377), and [roof, way 194458106](https://www.openstreetmap.org/way/194458106). The landmarks module deliberately skips these four records to prevent duplicate structures.

## Operator reference and appearance

- [Official Monza 2026 Grand Prix hospitality brochure, page 14](https://www.monzanet.it/wp-content/uploads/2025/11/Brochure_Hospitality_GPf12026.pdf#page=14): the photograph shows the tower's rounded blue-glass front, narrow metal mullions, opaque horizontal bands, upper glazed room, roof edge and external access stair. These visible features inform the tower mesh. The source does not supply measured tower dimensions; the two towers share an authored interpretation of this architectural family, not an assertion that their real structures are identical.
- [Official 2021 Monza event map, page 1](https://www.monzanet.it/images/content/pages/docs/autodromo-monza-zGm6Kn-zs8UE9Xz.pdf#page=1): identifies the medical centre south of the F1 paddock and distinguishes the hospitality building and paddock club. This is a dated reference, not a claim that every temporary installation remains in its 2021 position.
- [Monza's history of the circuit](https://www.monzanet.it/autodromo-di-monza-storia/) describes the medical centre and the facility's development. It supports the building's role, not detailed facade measurements.

The low buildings retain the mapped footprints, including irregular outlines. Roof slabs, neutral plaster/concrete colors, garage doors, window bays, gutters, drainpipes, medical-building trim and roof equipment are restrained authored treatments. No photographic evidence is claimed for their exact bay count, colors, height or roof profile. Google imagery is not used as a runtime texture or copied into the geographic data.

## Placement and safety envelopes

Tower points project to approximately these simulation stations before any facade modeling:

| Tower | Geographic track distance | Lateral position | Local heading |
| --- | ---: | ---: | ---: |
| Torre Nord | 274.48 m | −15.16 m | 0.0848441 rad |
| Torre Sud | 5480.78 m | −11.29 m | 0.0942351 rad |

Negative lateral position is left of the direction of travel. Point positions are preserved; the 6.0 m authored width and 7.2 m depth are oriented to the local straight, and stairs extend on the park side. Source waypoints do not determine these footprint dimensions. The nearest modeled tower edge clears the 7.4 m paved band by about 0.89 m at Torre Sud and 4.76 m at Torre Nord. The surrounding barrier must use the same local clearance treatment as the integrated track builder; the former generic 14 m outside barrier passed through these mapped tower locations.

Every footprint edge is sampled at intervals no longer than 3 m before adding its mesh. Buildings intersecting the paved road envelope are rejected; the normal service buildings have at least 33.98 m clearance to that envelope. The module adds tree-exclusion bounds before tree generation, but introduces no new collision body on the driving surface. It does not move the circuit or its timing lines.

## Rendering and verification

`createMonzaLandmarks(context, referenceData)` is synchronous. The world supplies its existing shared material, mesh and box helpers, so repeating facade details join the normal spatial box batches. Polygon extrusions are merged by material response and 300 m cells. The resulting additions use six extrusion batches, 1,144 shared-box instances, 892 extrusion triangles and 14,620 triangles including the boxes. These are geometry counts, not measured frame rates.

The returned statistics (also at `root.userData.monzaLandmarks`) identify every rendered source object, mapped center, heading, track station, lateral position, authored dimensions and minimum pavement clearance. They distinguish a mapped footprint from an authored footprint around a mapped point. The module tolerates an empty reference for isolated use; the integrated world requires the bundled `monza-landmarks.json` and reports a startup error if it cannot load.

CPU verification checks that every selected footprint and point exactly matches the original extract, all positions and dimensions are finite, all twelve buildings and both towers are generated, no feature is rejected, and every sampled footprint edge clears the paved band. Full visual and driving checks belong to the integrated world build.

The map objects have different edit dates and do not constitute a current building survey. This addition does not assert a reconstruction of the 2026–2027 redevelopment or event-dependent tents, hospitality lounges, temporary grandstands and vehicles.
