Original prompt: 7x7 spec (browser 3D city builder set in San Francisco, Cities: Skylines spirit, pure sandbox). Build Phase 1 Core: SF map + terrain, camera (trackpad + mouse), roads with curves and bridges, zoning (3 tools, light/dark), demand-driven growth through the population tiers, procedural buildings, building info, RCI bars, day/night, undo, save slots + autosave.

## Done (Phase 1)
- Map: real coastline (DataSF Analysis Neighborhoods + US Census county boundaries), hand-shaped hills from the pasted tables, GGP + Presidio as open wooded land, Alcatraz, Treasure Island, distant Marin / East Bay backdrop.
- Camera: drag / two-finger scroll pan, pinch or wheel zoom at cursor, right-drag rotate, WASD/QE/RF/+-, touch gestures.
- Roads: street, avenue, boulevard, one-way, highway, ramp; straight chain, 3-click curve, drag grid; snapping, intersection splitting, automatic bridges over water.
- Zoning: brush, block fill, rectangle, de-zone; R/C/O/I in light and dark density.
- Sim: R/C/O/I demand, lot fitting, upgrades by centrality, 9 tiers Rural to Metropolis.
- Buildings: procedural per-seed (window grids, setbacks, cornices, deco crowns, rooftop clutter), lit windows at night.
- UI: stats, RCI bars, clock + speed (pause/1x/2x/4x), time-of-day slider, building info + demolish, undo/redo, bulldozer, menu with 3 slots + autosave + export/import.
- Test hooks: window.advanceTime(ms), window.render_game_to_text(), window.resumeRealtime().

## Verified with real input (Playwright, software GL)
Straight chain, curve, grid drag, block fill, rectangle, brush, undo/redo keys, growth, info panel, demolish, bulldoze click + drag + road, pause, time-of-day, save/load slot, export/import, bad import error, bridge to Treasure Island, wheel / pinch / rotate / drag / keys, 390 px layout.

## Known limits / next
- Save slots are in memory only in the hosted preview (no browser storage in the sandboxed host). Export/import is the durable path. Swap in localStorage/IndexedDB for the Vercel build.
- Highways and ramps meet at grade. One-way is visual only until traffic (Phase 2).
- Frame rate not measured on a real GPU. Resolution scale steps down when fps < 27.
- Office/commercial demand saturates fast in the demo; skyline peak is modest.
- Trackpad vs mouse wheel is auto-detected via wheelDeltaY; override in Menu > Scroll wheel.
