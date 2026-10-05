# Monza track details — October 2026 pass

`src/track-details.js` adds post-resurfacing kerb colours and profiles, upper catch fencing, and a conservative subset of unlit marshal LED panels. The reference appearance is **August–September 2024**, not an asserted survey of the 2026 circuit.

## Inspected references

- [The Race, Edd Straw, 29 August 2024](https://www.the-race.com/formula-1/unusual-problem-f1-drivers-monza-track-changes/). Three photographs were downloaded temporarily and visually inspected: [LC1_0833](https://storage.ghost.io/c/dd/af/ddafbd99-2ccd-468c-b622-4b3cccf80b49/content/images/size/w1000/2024/08/LC1_0833.JPG), [LC1_0847](https://storage.ghost.io/c/dd/af/ddafbd99-2ccd-468c-b622-4b3cccf80b49/content/images/2024/08/LC1_0847.JPG), and [LC1_0854](https://storage.ghost.io/c/dd/af/ddafbd99-2ccd-468c-b622-4b3cccf80b49/content/images/2024/08/LC1_0854.JPG). The chicane close-ups show low green/white/red/white painted slabs, a narrow orange rear bevel, green paving and fresh dark tarmac. They also show closely spaced fence wires and substantial posts beyond the runoff. Images are reference-only and are not shipped as textures.
- [ACI, 27 August 2024](https://aci.gov.it/comunicati-stampa/monza-torna-il-gp-ditalia-di-f1-sulla-pista-rinnovata/), confirms resurfacing, replacement of all kerbs, first-chicane widening and drainage work. This supports the newer reference year; it does not supply construction measurements.
- [GT2 European Series official Monza briefing, 19 September 2024](https://www.gt2europeanseries.com/documents/notice/1649/Briefing%2BNotes%2BGT2%2BMonza.pdf), pp. 1–3 and 7. Page 2's Roggia escape-route image was rendered locally and inspected. The notes confirm installed FIA light panels and identify the two chicane escape routes. They also describe the new 2.5 m gravel strips at Turn 2 and between Turns 4–5.
- [FIA 2025 Monza circuit map, issued 4 September 2025](https://www.fia.com/system/files/decision-document/2025_monza_event_-_circuit_map_-_monza_2025_0.pdf), consulted for the distinction between marshal posts and numbered light panels. Its text was readable, but the image download returned HTTP 403. Consequently the added panels do **not** claim its exact numbering or locations.

## Geometry and contact

The fourteen existing kerb intervals remain unchanged. Their lateral bounds come directly from `track.surfaceBands.kerb` (6.04–7.55 m). The mesh replaces the former flat ribbon and protruding ribs with separate painted slab faces, shallow seams and a low stepped cross-section. Chicane orange bevels occupy only the outermost 0.29 m of that existing kerb contact band and taper around the approximate apex. Other kerbs retain a low profile. The same green rear strip is reconstructed from `surfaceBands.kerbRunoff`; its grip remains asphalt.

The inferred 2.5 m paint repeat, low heights, bevel width and slab subdivision are authored visual proportions, not measured values. Existing kerb tyre response is preserved. In particular, no deep historic Ascari drain trough is added to the post-2024 kerbs.

Upper catch fencing is added to seven sections: the main-straight spectator side, both sides of Rettifilo, Roggia's outside, both sides of Ascari and Alboreto's outside. The lower fence and collision barrier stay in place. Upper mesh slopes 0.64 m towards the track between heights 3.40–4.65 m, well above the car; these dimensions and exact intervals are authored. Continuous masts connect the angled arms to guardrail height. Meshes and instanced braces are grouped by section for culling.

Six black LED panels use the already authored marshal-station vicinity after Turns 1, 4, 6, 7, 8 and 11. Their supports sit beyond the modeled barriers. Recessed lens texture, housing depth, hood and steel mounting distinguish them from ordinary signs. They remain unlit because the simulator has no marshal-flag state. They carry no fabricated FIA numbering.

## Deliberately retained limitations

The existing level 12 m road and mapped centerline remain unchanged. Real bypass roads and the new narrow gravel strips require corresponding surface, collision, track-limit and recovery changes. Painting them over the current grass or asphalt contract would misrepresent their grip, so they are documented for a separate change instead of added as a cosmetic road. This pass does not claim to reproduce first-chicane widening or surveyed road-edge geometry.

Runtime assets are generated locally; no copyrighted reference photos or Google imagery are redistributed.
