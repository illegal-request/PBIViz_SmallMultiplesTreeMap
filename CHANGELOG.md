# Changelog

All notable changes to this project are documented here. Versions follow the Power BI visual's four-part `major.minor.patch.build` scheme from `pbiviz.json`.

## [0.2.30.0] - Unreleased

- Added `labelOverride` field well (Block Display Name) — shows a friendlier label on blocks while `label` (Item Name) remains the cross-filtering identity.
- Panel titles now use the measure's actual display name instead of a hardcoded unit suffix.
- Added a `tooltips` field well with report-page tooltip support (`supportEnhancedTooltips`).
- Added an optional persistent ("sticky") tooltip mode that stays open on hover, with configurable max height, alongside the native Power BI tooltip.
- Added a detail popup shown on block click, with full row detail and page-level cross-filtering while open.
- Added panel border styling (inset, so borders don't merge between adjacent panels) and a panel title background color option.
- Removed the unused, no-longer-imported `treemapPanel.ts` module.

## [0.2.18.0] - 2026-06-04

- Text overflow control (clip / truncate / wrap / resize-to-fit) and a minimum-width threshold for item labels.

## [0.2.17.0] - 2026-06-04

- Renamed the visual and its data roles for clarity, added a legend, removed the old canvas format pane object, and reorganized the format pane.

## [0.2.16.0] - 2026-06-04

- Bold, alignment, and per-element font color for all text elements.

## [0.2.15.0] - 2026-06-03

- Cached color keys so custom colors survive field-well changes in the format pane.

## [0.2.14.0] - 2026-06-03

- Proportional panel layout; fixed the size-scale dropdown.

## [0.2.13.0] - 2026-06-03

- Stable color slots, group item counts, and item labels.

## [0.2.12.0] - 2026-06-03

- Implemented `getFormattingModel()` for grouped, per-status-value color pickers.

## [0.2.11.0] - 2026-06-03

- Categorical DataView for a grouped color-picker UX; fixed `(Blank)` value handling.

## [0.2.10.0] - 2026-06-03

- Replaced per-row color selectors with stable null-selector color slots.

## [0.2.9.0] - 2026-06-03

- Unique clip-path IDs per panel; deduplicated items by (label + colorKey).

## [0.2.8.0] - 2026-06-03

- Show group labels on any tile that physically fits one.

## [0.2.7.0] - 2026-06-03

- Read saved colors back from `table.objects` so the format pane reflects prior selections.

## [0.2.6.0] - 2026-06-03

- Reverted the categorical `dataViewMapping` experiment; back to table-only.

## [0.2.5.0] - [0.2.2.0] - 2026-06-03

- A sequence of fixes stabilizing the categorical `dataViewMapping` (color mapping, blank `colorBy` handling, sqrt size scaling, stable color selectors, `additionalProjections` errors).

## [0.0.2.0] and nested redesign - 2026-06-02 – 2026-06-03

- Introduced the Panel → Group → Item data hierarchy (`panelBy`/`groupBy` roles) and the nested D3 treemap renderer (top-level panels, group tiles, leaf blocks), replacing the flat single-level treemap.

## [0.0.1.0] - 2026-06-02

- Initial prototype: pbiviz project scaffold, `dataTransform`, `ColorManager`, D3 squarified treemap rendering, format pane settings, grid layout, and cross-filter/highlight interactivity.
