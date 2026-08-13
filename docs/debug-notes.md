# SMTreemap Debugging Notes
*Last updated: 2026-06-02*

## Current Status
**Blocked on rendering.** Data pipeline works correctly. Rendering produces a blank box.

## What Works
- Power BI loads the visual without errors
- Fields can be dragged into wells (after `for/in` fix in capabilities.json)
- `update()` is called correctly with data
- `transformDataView` correctly produces panels (confirmed: 1 panel, 46 segments, seg0: Category A=531)
- SVG created **inline** in `visual.ts` using `this.container.ownerDocument` renders correctly (confirmed in build 0.0.3.0 — green rect with "46 segs" text was visible)

## Root Cause (Identified, Not Yet Fixed)
**Cross-module rendering is broken.** Any SVG/DOM creation that happens inside a function defined in a *separate imported module* (`treemapPanel.ts`) produces no visible output, even when:
- The document reference is passed explicitly as a parameter
- The container is appended to the live DOM before the function is called
- No errors are thrown (try/catch returns clean)
- The DOM manipulation (clear/remove) DOES work across modules — only createElement/appendChild of new content fails visually

**Key evidence:**
- Build 0.0.3.0: inline SVG in `visual.ts` → green rect VISIBLE ✅
- Build 0.0.4.0–0.0.7.0: same SVG in `treemapPanel.ts` (imported module) → blank ❌
- Build 0.0.7.0: local function defined *inside* `update()` in `visual.ts` → blue rect VISIBLE ✅
- Build 0.0.8.0: `renderPanel` moved to module-level function in `visual.ts` (not imported) → blank ❌

## What We've Tried
1. `bind/to` + `for/in` mix in dataViewMappings → broke field dragging (reverted)
2. Added `conditions` to dataViewMappings → blocked field dragging entirely (reverted)
3. Changed all `dataViewMappings` to `for/in` for all roles → fixed field dragging ✅
4. Passed `doc = this.container.ownerDocument` into `renderPanel` → still blank
5. Replaced all D3-selection DOM calls with vanilla `createElementNS` → still blank
6. Appended cell to live DOM BEFORE calling renderPanel → still blank
7. Moved `renderPanel` inline to `update()` method as local function → visible ✅
8. Moved `renderPanel` to module-level function in `visual.ts` (outside class) → blank ❌

## Critical Clue — Build 0.0.8.0 Result
`renderPanel` defined at module level in `visual.ts` (not imported, not inside class/method) → STILL blank.

This means the issue is NOT just "imported module" vs "not imported" — it's specifically about functions defined **inside** the `update()` method body vs functions defined outside it (at module scope or in another file).

## Likely Cause
Power BI's visual sandbox may be running the `update()` method in a specific execution context (perhaps a Proxy or sandboxed window) where the `this.container.ownerDocument` accessed *within* `update()` is different from the same reference accessed in functions called from `update()`.

The `localRender` function defined INSIDE `update()` closes over variables from `update()`'s scope, including `doc` and `NS`. Functions defined outside `update()` receive `doc` as a parameter — but that parameter value, while referencing the same object, may behave differently when used to create DOM elements outside the `update()` execution context.

## Recommended Next Steps
1. **Try defining renderPanel as a method on the Visual class** (not module-level, not inside update — as a `private renderPanel(...)` method). Class methods execute in the same context as `update()` via `this`. Call it as `this.renderPanel(cell, panel, ...)` without passing `doc` — use `this.container.ownerDocument` directly inside the method.

2. **If class method works**: the issue is closure/execution context specific to module-level functions called from within Power BI's sandboxed `update()`. Keep all rendering as class methods.

3. **If class method still blank**: the issue is even more fundamental — try calling `options.element.ownerDocument` in the constructor and storing it as `this.doc` for use throughout.

## Current File State (build 0.0.8.0)
- `src/visual.ts`: Contains `renderPanel` as module-level function + `Visual` class. All debug overlays REMOVED. Clean production code (minus the rendering issue).
- `src/treemapPanel.ts`: Exists but is no longer imported by visual.ts (dead file).
- `src/dataTransform.ts`: Working correctly ✅
- `src/colorManager.ts`: Working correctly ✅  
- `src/settingsParser.ts`: Working correctly ✅
- `src/types.ts`: Working correctly ✅
- `capabilities.json`: All roles use `for/in`, no conditions. Working correctly ✅
- Current version: `0.0.8.0`
- Current build: `dist/SMTreeMap_0.0.8.0.pbiviz`

## Data Model (Confirmed Working)
- Field wells: Group By → Region, Label → Category, Value → Units Sold, Color By → Priority Level
- groupBy and colorBy are optional; label and measure required
- With just label+measure: produces 1 panel with 46 segments, correct values
