# Driving model

The visible car is Excalibur's **2021 McLaren MCL35M**, with axle, wheel and collision dimensions taken from the imported mesh. Its handling still uses authored **2025-style hybrid** coefficients intended to make braking, line choice, aerodynamic grip, throttle application and off-track excursions matter. It has not been calibrated against proprietary MCL35M telemetry or tire data, and is not a professional driver-training simulator.

## What is simulated

`src/physics.js` integrates independent planar position, longitudinal and lateral velocity, heading and yaw rate at **120 Hz**. A render frame may execute several fixed physics steps. A single incoming frame is limited to 100 ms, so returning to a backgrounded browser does not simulate a long interval of stale keyboard input.

Each axle produces lateral force from its own slip angle using a smooth, saturating tire curve with mild post-peak falloff. Longitudinal and lateral forces share a friction circle. Thus braking and acceleration consume grip that could otherwise turn the car. Front and rear axle loads depend on weight, aerodynamic load and longitudinal weight transfer. Grip includes small tire load sensitivity, temperature, wear and surface multipliers. A low-speed kinematic blend avoids the tire-slip singularity near rest; this is a numerical compromise rather than a full contact-patch model.

A rear-wheel drivetrain supplies torque through eight ratios, a simple engine torque curve, clutch approximation and shift torque cuts. Automatic shifting has hysteresis. Manual downshifts that would exceed the permitted engine speed are refused. Engine braking, quadratic aerodynamic drag, rolling resistance and fuel mass affect the motion. Boost draws up to 120 kW from a 4 MJ energy store. Braking and low-throttle running replenish the store with a simplified recovery model. DRS reduces drag and rear aerodynamic load only in track-defined zones, at sufficient speed, with the brake released.

The nominal 800 kg unfueled mass, eight forward ratios, and hybrid-era architecture are based on the [FIA's 2025 Technical Regulations, issue 1](https://www.fia.com/sites/default/files/fia_2025_formula_1_technical_regulations_-_issue_01_-_2024-12-11_1.pdf). The numerical torque curve, ratios, aerodynamic areas, mechanical grip, temperatures, wear and recovery schedules are **our design choices**. This does not model the 2026 power-unit or active-aero rules.

The tire-force design follows the general load/slip and shared-friction principles described by [NVIDIA's PhysX vehicle documentation](https://nvidia-omniverse.github.io/PhysX/physx/5.1.0/docs/Vehicles.html). PhysX is not a dependency and no PhysX code is used here.

## Vehicle geometry

`new VehiclePhysics(track, options)` accepts an optional complete `options.geometry` object, in metres:

```js
{
  wheelbase, frontAxle, rearAxle, wheelRadius,
  width, frontExtent, rearExtent
}
```

`frontAxle` is positive and `rearAxle` is negative, measured from the physics origin along the car's forward axis. Both body extents are positive: the longitudinal collision range is `[-rearExtent, frontExtent]`. The wheelbase must equal `frontAxle - rearAxle` within 0.00001 m, and the extents must include each axle plus the tyre radius. Every dimension must be finite with magnitude between 0.01 m and 20 m. These broad numerical bounds reject unusable inputs; they are not a vehicle-class regulation. Malformed or incomplete geometry throws before the simulation starts.

Validated values are copied into the immutable `vehicle.geometry`. They control rolling-radius RPM, torque at the road, downshift protection, static axle loads, longitudinal load transfer, steering limits, slip and yaw lever arms, parking-speed kinematics, wheel rotation and the barrier envelope. Normal `setOptions(settings)` calls and `reset()` preserve the geometry. Geometry cannot be replaced through `setOptions`; create a new `VehiclePhysics` instance when changing models.

Without an override, `VEHICLE_CONSTANTS` retains the original AP-25 dimensions and behavior. Geometry selection does **not** calibrate a different season's power unit, tyres or aerodynamics: mass, engine curve, ratios, yaw inertia, aerodynamic balance and force coefficients remain the authored handling model described above. In particular, a 2021 visual model does not imply validated 2021 McLaren telemetry.

## Driver assists

With assists enabled, steering travel reduces with speed and available tire grip. Traction control limits driven-axle longitudinal force, brake force is limited near the tire capacity, and a modest yaw damper helps keyboard stability. These are accessibility aids: real F1 cars do not have these driver aids. **They do not follow the centerline, choose a cornering path, slow down for corners or prevent the user from leaving the track.** With assists disabled, full steering travel and unassisted tire saturation make abrupt inputs much harder to recover.

Input smoothing is applied separately to keys and gamepad sticks. Keyboard steering takes a short time to build and unwind; gamepad steering uses a deadzone and exponential response for small corrections. Opposing keyboard inputs cancel. Blur, hidden tabs and disabling input clear held controls. The gamepad layout assumes the standard browser mapping.

| Action | Keyboard | Standard gamepad |
| --- | --- | --- |
| Throttle | W / Up | Right trigger |
| Brake | S / Down / Space | Left trigger |
| Steer | A, D / Left, Right | Left stick |
| Boost | Hold Shift | Hold bottom face button (A / Cross) |
| DRS | Hold E | Hold top face button (Y / Triangle) |
| Gear up / down | X / Z | Right / left shoulder |

The main application owns pause, camera switching, reset and HUD controls. Touch controls set the controller's mutable `touch` object and use the same force model.

## Track surfaces and impacts

The track provides its nearest centerline point, signed lateral distance, road width and separate left/right barrier distances. Positive lateral distance means the right side when facing forward. Kerbs have slightly lower grip; grass and gravel reduce grip and add resistance. Where no detailed surface function is available, surface bands are inferred from distance to the road edge. They are approximate surface regions, not a surveyed tire-contact material map.

Barrier response uses an oriented planar rectangle from `vehicle.geometry`. Its default matches the authored AP-25's nominal envelope: **2.000 m wide**, extending **3.0984 m ahead** and **2.6572 m behind** the physics origin. Those default longitudinal bounds are rounded outward from measured mesh bounds to 0.1 mm. `VEHICLE_CONSTANTS` exposes the default `width`, `frontExtent`, `rearExtent`, `frontAxle`, `rearAxle`, and `wheelRadius`; a regression checks them against the authored car geometry. The center-of-mass origin is not necessarily the rectangle's midpoint.

For heading difference `d` between car and local road frame, let `s = sin(d)`, `w = geometry.width / 2 * abs(cos(d))`, `F = geometry.frontExtent`, and `B = geometry.rearExtent`. The projected distances from the car origin toward each wall are:

```text
right support = w + F * max(s, 0) + B * max(-s, 0)
left support  = w + B * max(s, 0) + F * max(-s, 0)
allowed lateral interval = [-barrierLeft + left support,
                             barrierRight - right support]
```

Both walls are checked regardless of which side contains the car center. This catches a sideways nose or rear overhang reaching a wall while the center remains inside, including cases where the center is on the opposite side of the road. The track's `right` normal is normalized; its heading, or tangent when necessary, supplies the fallback frame. Position correction and velocity response stay in geographic X/Z coordinates.

The car origin is projected into the allowed interval. For motion toward the contacted wall, the existing response retains 12% of the outward normal speed as rebound, applies the existing speed-dependent scrub loss, damps yaw rate to 35%, and adds damage from normal impact energy. Damage reduces downforce and increases drag. An overlap being cleared while the car moves away causes no additional impulse or damage. **Contact alone does not invalidate a lap**; the existing track-limit and session rules still apply, and a previously invalid lap stays invalid.

This remains a discrete, local approximation evaluated at 120 Hz. The two walls are treated as parallel tangent planes at the center's nearest track sample, not sampled separately at every corner. The rectangle fills empty space around the tapered body, and its nominal width does not model the swept geometry of a fully steered wheel. Curved barriers, abrupt wall-offset changes, segment ends, continuous swept contact, corner-specific impulses, angular contact velocity, deformation and car-to-car rigid-body collisions are not resolved. If a custom corridor is too narrow to fit the car at its current heading, the fallback balances unavoidable overlap without alternating the center between walls; it cannot make an impossible pose fit. Wheel detachment and barrier flex are not simulated.

## Telemetry contract

| State | Unit / meaning |
| --- | --- |
| `x`, `z`, `distance`, `lateral`, `travelDistance` | meters |
| `heading`, `steeringAngle`, `slip`, `frontSlip`, `rearSlip` | radians |
| `speed` | magnitude of planar velocity, m/s |
| `forwardSpeed`, `lateralSpeed`, `vx`, `vz` | signed m/s |
| `yawRate` | radians/second; positive turns right |
| `steering` | normalized driver steering, -1 to 1 |
| `throttle`, `brake`, `ers`, `damage` | 0 to 1 |
| `tyreWear` | 0 to 1, where zero is a new tire |
| `tyreTemp`, `brakeTemperature` | degrees Celsius |
| `fuel` | kilograms, starting at 32 |
| `gForce.x`, `gForce.y` | lateral and longitudinal acceleration in g |
| `downforce` | newtons |
| `enginePower` | watts, including requested boost |
| `collision` | decaying impact effect, 0 to 1 |
| `wheelRotation` | wheel angle in radians |
| `rideHeight`, `suspensionTravel` | visual body-height offset in meters |

`reset(distance)` restores new tires, fuel, energy, damage, input state and motion, and spawns aligned with the track. It preserves the identity of the `state` object for render subscribers. `validLap` becomes false on a substantial off-track excursion; wall contact has no independent invalidation rule. Session logic still controls recovery, ordered timing gates and the beginning of a subsequent lap.

## Demonstration driving and timing

`src/autopilot.js` produces normal steering, throttle, brake, boost and DRS inputs. Its speed profile uses a smoothed geographic heading change with forward acceleration and backward braking limits. The demonstration runs through the same tire model as manual driving; it never moves the car directly onto the centerline. It is intentionally conservative and does not represent an optimized real-world qualifying lap.

The session timer uses Monza's separate control/finish line, 309 m behind the start grid. This offset is published in the [FIA competition visa, page 4](https://www.fia.com/system/files/decision-document/2026_italian_grand_prix_-_competition_visa.pdf); its placement on our geographic polyline is inferred as described in `docs/TRACK.md`. Sector offsets and DRS activation references follow the [FIA 2025 event map, page 2](https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exit_map_quarantine_zone_and_red_zones.pdf), with approximate mapped corner references and authored DRS braking gates.

The vehicle's `distance`, track sampling, `Session.reset(distance)`, `Session.recover(distance)` and `Session.bestTimeAtDistance(distance)` all retain the geographic origin at the start grid. Session snapshots, sequential gates, `session.sectorDistances` and ghost frame distance instead use forward distance from the control line. `track.toLapDistance()` and `track.fromLapDistance()` convert between these origins. Telemetry charts use `track.lapSectors` alongside recorded frame distances.

Launching from the grid sets `session.outLap = true` while `session.valid` remains true for a clean opening run. That partial run cannot be recorded as a personal best or a completed lap. The first forward control-line crossing clears `outLap` and starts a full timed lap. Crossing geographic distance zero merely passes the start grid, 309 m into that lap. Deltas are withheld during the out lap. Recovery still invalidates the active lap and accepts a geographic position; it cannot bypass the ordered gates or required progress for a complete lap.

Sector and control-line crossings are interpolated inside each physics step. Ghost telemetry includes exact control-line endpoints with distances 0 and 5793, plus 10 Hz intermediate samples; live deltas interpolate between recorded samples. Saved timelines are validated before replay. Version `monza-geographic-2025-v3-control-line` rejects ghosts saved against the former start-grid timing origin. Setting `session.recordEnabled = false` permits demonstration timing and history without replacing or persisting the driver's personal best.

A detected position discontinuity that straddles the control line invalidates both the ending lap and the newly started lap: the skipped beginning cannot count toward a personal best. The next continuous control-line crossing can start a clean lap. Timing accepts positive steps up to 100 ms, matching the application's maximum incoming frame interval; normal calls remain 1/120 s. An unsupported larger interval invalidates the lap, re-anchors the position, and leaves elapsed/lap time and recorded frames unchanged. It does not infer a crossing or synthesize a potentially unbounded ghost timeline for an unobserved gap.

## Validation and limits

`node tests/physics.test.mjs` covers progressive launch, automatic gears, braking to rest, mirrored steering, frame-rate independence, off-track grip, barrier containment and energy loss, manual shift edges, reset, boost recovery, DRS brake cancellation, finite state under extreme input, and input release. Collision regressions verify mesh dimensions, transformed rectangle corners for parallel/oblique/sideways/reverse impacts on both walls, rotated geographic frames, asymmetric wall distances, opposite-side center/nose contact, unchanged free motion when the envelope is clear, impulse-free separation, road-frame fallback, and stable behavior in an infeasible narrow corridor. Clean on-track wall touches remain valid.

Alternate-geometry regressions cover input validation and immutability, settings/reset persistence, radius-dependent engine RPM and drive force, wheel rotation and over-rev rejection, axle-spacing turning radius, axle-balance launch traction, acceleration/braking at 30 and 120 Hz, and transformed collision corners for a differently sized body. These validate implementation consistency rather than measured real-car performance.

`node tests/autopilot.test.mjs` drives three complete control-line-to-control-line Monza laps through the force model and session timer, checking track limits, impacts, sectors, storage reload and recovery. A constant-speed pass verifies exact shifted lap boundaries and ghost positions, interpolation, demonstration isolation, rejection of corrupted saves and rejection of the old timing-origin version.

`node tests/timing.test.mjs` checks the published offsets, reversible geographic/timing conversion, DRS availability across the geographic seam, the opening grid out lap, full-lap personal-best eligibility, precise sector durations, reverse/teleport/recovery protections, invalidity on both sides of a discontinuous finish crossing, and bounded rejection of unsupported timing gaps.

Initial automated straight-line checks with assists, soft tires and DRS requested gave roughly 2.8 s to 100 km/h and 5.4 s to 200 km/h with boost. These are implementation checks rather than evidence of real-car fidelity. Conditions and tuning changes will alter the figures.

The model is planar: banking, wheel-by-wheel suspension, aerodynamic floor stall, wind, wet-weather contact, vertical jumps, differential torque transfer, tire carcass dynamics, brake lockup rotation and a complete thermal power-unit model are outside its present scope. Visual suspension motion is a presentation effect. The source coefficients are deliberately compact so later work can replace these approximations with measured or better validated systems.
