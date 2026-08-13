# PBIViz Small Multiples TreeMap

A custom Power BI visual that renders a grid of D3 treemaps — one panel per unique value of a grouping field, with items inside each panel further grouped into labeled tile sections. Built with the Power BI Custom Visuals SDK, TypeScript, and D3 (`d3-hierarchy`).

## Features

- **Panel / Group / Item hierarchy** — split data into one treemap per panel, group items within each panel into labeled tile sections, and size individual blocks by a measure.
- **Proportional or fixed grid layout** — panels auto-arrange in a roughly square grid, or lock to a fixed column count.
- **Linear, square-root, or logarithmic size scaling** for block area.
- **Per-category color mapping** with format-pane color pickers, falling back to the report theme palette for unmapped values.
- **Legend** with configurable position, title, and text styling.
- Independent text styling (font size, bold, alignment, color) for panel titles, group labels, and item labels, each with configurable text overflow behavior (clip, truncate, wrap, or resize-to-fit) and a minimum tile size below which labels hide.
- **Optional display-name override** — show a friendlier label inside blocks while keeping a separate field as the identity used for cross-filtering.
- **Tooltips** — native Power BI tooltips (including report-page tooltips) or an optional persistent "sticky" tooltip that stays open while the mouse is over it, with a configurable max height and extra fields from a dedicated Tooltips field well.
- **Detail popup on click** — an in-visual modal showing full row detail for a block, which cross-filters other visuals on the page while open.
- **Panel border and panel title background** styling.
- Standard Power BI cross-filtering (click to select/deselect) and highlight support.

## Field wells

| Well | Display name | Cardinality | Purpose |
|---|---|---|---|
| `panelBy` | Split Into Panels | Multiple | One panel per unique value combination |
| `groupBy` | Group Into Tiles | Multiple | Items within each panel are grouped into labeled tile sections |
| `label` | Item Name | Single (required) | Name of each leaf block; also the cross-filtering identity |
| `measure` | Block Size | Single (required) | Numeric value driving block area |
| `colorBy` | Color Category | Single | Categorical field that determines each block's color |
| `labelOverride` | Block Display Name | Single | Optional friendly name shown on the block instead of Item Name |
| `tooltips` | Tooltips | Multiple | Extra fields shown on hover; also enables report-page tooltips |

## Format pane

Grid, Panel Title, Group Labels, Item Labels, Legend, Values (size scale), Detail Popup, Tooltip Options, Panel Border, plus one color picker per unique Color Category value.

## Development

Requires the [Power BI custom visuals tooling](https://learn.microsoft.com/power-bi/developer/visuals/environment-setup) (`pbiviz`) and a Power BI Desktop/Service environment with developer mode enabled for live sideloading.

```bash
npm install
npm start        # serves the visual at https://localhost:8080 for sideloading
npm test          # run the Jest unit tests
npm run lint       # run ESLint
npm run package     # build dist/PBIVizSmallMultiplesTreeMap_<version>.pbiviz
```

## Installing the built visual

1. Run `npm run package` to produce `dist/PBIVizSmallMultiplesTreeMap_<version>.pbiviz`.
2. In Power BI Desktop, use **Visuals → Import a visual from a file** and select the `.pbiviz` file.

## Project structure

```
src/
  visual.ts          # IVisual entry point — update lifecycle, rendering, format pane, interactivity
  dataTransform.ts   # Power BI DataView -> Panel[]/Group[]/Item[] hierarchy
  colorManager.ts     # Color-key -> format pane color / theme palette resolution
  settingsParser.ts    # Format pane object <-> VisualSettings parsing
  types.ts               # Shared types and default settings
capabilities.json         # Field wells and format pane property definitions
pbiviz.json                # Visual metadata (name, guid, version)
test/                        # Jest unit tests for dataTransform and colorManager
```

## Known limitations

- **No accessibility support** — the visual doesn't yet implement keyboard navigation or high-contrast mode. `pbiviz package` flags both as recommended but missing.
- **Uneven test coverage** — `dataTransform.ts` and `colorManager.ts` have unit tests; `visual.ts` (rendering, tooltips, detail popup, format pane, interactivity) and `settingsParser.ts` do not.
- **Sideload-only** — not submitted for AppSource certification; install via **Import a visual from a file** rather than the marketplace.
- Also missing, per `pbiviz`'s recommended-feature checklist: a landing page (shown when no fields are assigned), localization, rendering-events telemetry, and selection across multiple visuals of this type on the same page.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
