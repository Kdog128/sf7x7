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

## Phases 2 to 5 (built)
Modules: structures.js (catalog, landmarks, venues, styles), city.js (64 m grids for land value, satisfaction, noise, services, transit, traffic; economy, taxes, policies, neighborhoods, history), tech.js (waves by year, random and manual booms and busts, startup lifecycle and directory), culture.js (venues, artists, lineups, leagues and seasons, 9 festivals, Grand Prix, Olympic bid, fires and quakes, 35 achievements, tips), life.js (cars, robotaxis, pedestrians, transit vehicles and routing, fog, rain, cranes, particles, event staging, air taxis), audio.js, place.js (placing, Smart-fill, terraforming, piers, street grid, south highway), cloud.js (Supabase RPC saves, sync code, share links), panels.js (City drawer), ui.js, save.js v2, api/detail.js (Claude prompt for Smart-fill, needs ANTHROPIC_API_KEY).

Decisions: 4 game days = 1 year (one per season). Map size reloads with ?map=compact|bay; saves record the map. Shared ?city=ID view is read-only and forces parody names. Saves live in Supabase (project iaxxvgwivltgevwkkgmi, sf7x7_ objects, RLS on, access only through security definer functions keyed by a sync code kept in a cookie). No browser storage APIs. T rotates a structure, C opens the City panel, H hides the HUD. window.advanceDays(n) fast-forwards for tests.

Verified in the browser with real input (software GL): setup options (map, start, era, money, interface, camera), demo, Build tool for every category, all 12 landmarks at their real sites on the real-scale map (with the demo district loaded, Transamerica did not place on Compressed, and Transamerica and Salesforce did not place on Bay Area; cause not confirmed, probably overlap with the demo), Smart-fill with checkboxes and prompt, undo and redo of fills, transit line drawing and routing, terrain raise, landfill, dig and pier, historic locks (click, drag, info panel), fire and earthquake, festivals, Grand Prix on streets, Olympic bid through to the vote, overlays and legend, weather, sound toggle, all City tabs, tech boom and bust, 20 years of fast-forward in Budget mode, cloud save, load, overwrite, share, read-only view, export, import of v1 and v2 files, 390 px layout.

Known limits:
- Not exercised: hosting the Olympic Games (bid and vote only), the 1999 era, ferry and cable car lines drawn by hand, removing and undoing a transit line, a live call to the Claude endpoint, audible sound output.
- Not rechecked after the fix: the water strip on the east edge of the Bay Area map.
- One reading in the software renderer showed 2,040 draw calls and 8M triangles after a fast-forward; not investigated.
- The cloud save list failed twice with a CORS preflight error during testing; one retry was added, cause not found.
- Landmarks keep their real size on the compressed maps.
- Frame rate is not measured on a real GPU. Simulation step is about 0.2 ms; rendering is the cost.
- Landmark coordinates are approximate. Bay Area coastline is the Census 500k outline.
- Metro runs at street level. A pier is a straight strip of landfill. Terraforming cannot be undone.
- Budget mode is generous: a 75,000 resident city banks money quickly.
- Simulated traffic affects land value and satisfaction; cars do not queue.
- Vercel deploy is blocked: the connected token cannot reach team kdog128-s-projects.
- Existing Supabase project has 8 unrelated tables with RLS disabled (reported to the user, not changed).
