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

## Look and map pass (after first playtest feedback)
Changes:
- Layout: stats and demand in the bottom dock, feed top centre, top right collapsible.
- Roads: screen-space snapping from every direction, Blocks mode (N by M stamp, T to turn), Copy and paste mode.
- Map: default is now "SF and neighbors" at 0.6 scale. Daly City, South City, Oakland, Berkeley and Marin are greyed out and open at 5,000 / 12,000 / 25,000 / 45,000 / 70,000 residents, or all at once from the start screen or the Neighborhoods tab. Real-scale and Compressed SF remain as options. Saves from the old Bay Area map are rejected with a message.
- Buildings: blocks.js adds rowhouses (Victorian, Italianate, Edwardian, Sunset stucco, Marina), bay-window flats, six shop kinds, parking garages, lofts, theatres and 18 industry kinds. Warmer pastel palettes, lower floor ranges outside downtown.
- Night: post.js (bloom and grade), lamp posts with light pools, glowing signs, floodlit landmarks and venues, roadway lamps and beacons on both bridges. Two modes, Realistic and Stylized, on the start screen and in the time-of-day pop-over. Post-processing is off on Low graphics and with ?fx=0.
- Cars, transit and people: models.js. Five car bodies with head and tail lamps, bus, cable car, tram, ferry, walkers with a walk cycle, scooters. These are coded, not from an asset pack.
- Demo district: replaced by the starter cities below.
- three.js and Lucide are vendored under vendor/ (no CDN at run time).
- Fixes found in QA: a degenerate road quad wrote a zero normal, which became a NaN pixel that bloom spread into a fully black frame at some window sizes (normals are now guarded in the mesh builder and the bloom and grade passes drop NaN and infinite pixels); rain streaks drew lines across the screen when one end wrapped; a snapped camera looked at sea level for a moment; team gating by year (Giants 1958, Warriors 1962, 49ers 1946, Sharks 1991, Earthquakes 1996, Valkyries 2025).

Facts rechecked against sources: Transamerica Pyramid 260 m, Salesforce Tower 326 m, Coit Tower 64 m, Ferry Building tower 75 m (all four corrected), Golden Gate towers 227 m, Oracle Park and Chase Center capacity, festival first years (Sketchfest 2002, Bay to Breakers 1912, Carnaval 1979, Pride 1970, Fleet Week 1981, Hardly Strictly 2001, Outside Lands 2008, Portola 2022, Dreamforce 2003), division rivals for each team. Venue lists include some rooms that have since closed (for example The Purple Onion); kept on purpose.

Verified in the browser (software GL): demo load, nearby city lock message, daily unlock, save and load of open areas, Neighborhoods tab list, night mode toggle, ?fx=0, 390 px layout, all 12 landmarks at their real sites on the region map (Transamerica needs its lot cleared when the demo is loaded), bridges at night, each vehicle and person model up close.

Still not verified: frame rate on a real GPU (post-processing adds cost; Auto drops it under 20 fps), hosting the Olympics, the 1999 era start, hand-drawn ferry and cable lines, removing a transit line, audible sound, the Claude endpoint, Budget mode balance.

## Starter cities and second check
- `js/presets.js`: four small built-up districts at their real locations, picked from "Starter cities" on the start screen or in the menu: Market Street, The Mission, Outer Sunset, North Beach.
- Every one draws the same staple streets from real coordinates (the Embarcadero, Market, Mission, Van Ness, Geary) and places the Ferry Building. North Beach adds Columbus Avenue and Coit Tower.
- Each district has its own rotated grid, civic lots, zoning rule, named transit lines and a fixed seed, so it is the same every load. Populations stay under 5,000 (about 1,900 to 4,500), so Daly City is still closed.
- Loose ends are tidied after drawing: streets that stop just short of another are joined, stubs under 100 m are removed. The only dead ends left are the far ends of the staples.
- Ferries now route over water between landings instead of sailing a straight line across land.
- Second check fixes: stale cloud save row shows an error instead of leaving the page; closed venues Bergerac and The Purple Onion removed; Palace of Fine Arts 49 m; Oracle Park 41,331; football stadium 68,500; Twin Peaks 276 m and 282 m; Mount Davidson longitude.
- No hospital in the Market Street starter: the 64 m lot does not fit the 80 m blocks. Add one after widening a block.

Verified in the browser (software GL): all four starter cities on the region map, Market Street on the real map, the Mission on the compact map through the map switch link; day, night and top-down views; no console errors; menu path to starter cities; slot save and load round trip; 390 px start screen; hand-drawn ferry line with the boat staying on the water.
Not verified: frame rate on a real GPU, sound output, Olympics, 1999 era start, Budget mode balance, the Claude detail endpoint. Muni line names in the starter cities are from memory.

## Sound, turned structures, resident reactions, highlight view
- Sound: the audio engine was never created (the first-click handler only resumed an engine that did not exist yet). It now starts on the first click or key press. Added a city hum that scales with population, and short sounds for roads, zoning, building, bulldozing, transit lines, undo and redo, tier changes and warnings.
- Turned structures: landmarks and buildings from the Build tool snap to face the nearest street at its real angle and step back until they clear the road. Q and E turn 15 degrees, T a quarter turn, Shift places freely, "Snap to street" can be turned off. Built structures can be turned from their details panel (Turn left, Face street, Turn right). The Ferry Building now sits along the Embarcadero. Turned lots own only the cells inside the turned footprint; angle is saved.
- Resident reactions (js/mood.js): each new structure gets a feed post, a "What people think" line and a local satisfaction change that fades over 8 game days. Clubs next to homes upset neighbors, clubs on a busy or nightlife street are welcome, stadiums excite the city but worry nearby residents, landmarks, parks and services are welcomed.
- Highlight view (js/finder.js), in the overlays panel: beams over every nightclub, music venue, comedy club, sports venue, landmark, service or park, with counts and Previous/Next to fly between them.
- Build options wrap onto a second row on wide screens instead of hiding controls.
Verified in the browser: audio level with an analyser (ambience about 0.02 RMS, a build sound doubles it, mute goes silent), club placed at 45 degrees on a diagonal avenue with a negative reaction, arena placed at 15 degrees with a positive one, undo and redo, save round trip keeps angles, panel turning, highlight beams and Next.
