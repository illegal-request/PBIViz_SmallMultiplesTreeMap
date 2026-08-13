import powerbi from 'powerbi-visuals-api';
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;

import { hierarchy, treemap, treemapSquarify, treemapBinary, HierarchyRectangularNode } from 'd3-hierarchy';
import { transformDataView, getMeasureName } from './dataTransform';
import { ColorManager } from './colorManager';
import { Panel, Item, VisualSettings, DEFAULT_SETTINGS } from './types';
import { parseSettings, enumerateInstances, getUniqueColorKeys, slotIndex } from './settingsParser';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Average character width as a fraction of font size (conservative estimate for proportional fonts)
const CHAR_W_RATIO = 0.55;

/** Shared scale function used for both item values and panel area computation. */
function applyScale(v: number, scale: 'linear' | 'sqrt' | 'log'): number {
  if (v <= 0) return 0;
  switch (scale) {
    case 'sqrt': return Math.sqrt(v);
    case 'log':  return Math.log(v + 1);
    default:     return v;
  }
}

/**
 * Processes a label string for a given available pixel width using the chosen overflow mode.
 * Returns the line(s) to render and the (possibly reduced) font size for 'resize' mode.
 */
function processLabel(
  text:      string,
  maxWidth:  number,
  fontSize:  number,
  overflow:  'clip' | 'ellipsis' | 'wrap' | 'resize'
): { lines: string[]; fontSize: number } {
  if (!text || maxWidth <= 0) return { lines: [], fontSize };
  const avgCw   = fontSize * CHAR_W_RATIO;
  const maxChars = Math.floor(maxWidth / avgCw);

  switch (overflow) {
    case 'ellipsis': {
      if (maxChars < 1) return { lines: [], fontSize };
      if (text.length <= maxChars) return { lines: [text], fontSize };
      return { lines: [text.substring(0, Math.max(1, maxChars - 1)) + '…'], fontSize };
    }
    case 'wrap': {
      if (maxChars < 1) return { lines: [], fontSize };
      const words = text.split(' ');
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (test.length <= maxChars) { cur = test; }
        else {
          if (cur) lines.push(cur);
          // Long single word: just truncate to fit
          cur = w.length > maxChars ? w.substring(0, maxChars) : w;
        }
      }
      if (cur) lines.push(cur);
      return { lines, fontSize };
    }
    case 'resize': {
      if (text.length === 0) return { lines: [text], fontSize };
      const needed = text.length * CHAR_W_RATIO;
      if (needed <= 0) return { lines: [text], fontSize };
      const scaled = Math.floor(maxWidth / (text.length * CHAR_W_RATIO));
      return { lines: [text], fontSize: Math.max(6, Math.min(fontSize, scaled)) };
    }
    default: // 'clip' — return text as-is; SVG clipPath handles the visual clipping
      return { lines: [text], fontSize };
  }
}

interface TreemapDatum {
  name: string;         // Item Name — filtering identity
  displayName: string;  // Block Display Name — what gets rendered
  value?: number;
  colorKey?: string;
  rowIndices?: number[];
  groupTitle?: string;
  rawTotal?: number;    // raw measure-value sum for group nodes
  children?: TreemapDatum[];
}

function renderPanel(
  container: HTMLElement,
  panel: Panel,
  width: number,
  height: number,
  settings: VisualSettings,
  colorManager: ColorManager,
  onItemClick: (item: Item, groupTitle: string, panelTitle: string, shiftKey: boolean) => void,
  highlightedLabels: Set<string> | null,
  onTooltipShow: (item: Item, groupTitle: string, panelTitle: string, event: MouseEvent) => void,
  onTooltipHide: () => void,
  onContextMenu: (item: Item, event: MouseEvent) => void,
  onGroupClick: (items: Item[], shiftKey: boolean) => void,
  onPanelClick: (items: Item[], shiftKey: boolean) => void,
  onClearSelection: () => void,
  doc: Document,
  panelIndex: number
): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  const titleHeight = settings.panelTitle.show ? settings.panelTitle.fontSize + 10 : 0;
  const svgHeight = height - titleHeight;

  if (settings.panelTitle.show) {
    const titleEl = doc.createElement('div');
    titleEl.textContent = panel.title;
    titleEl.style.cssText = [
      `font-size:${settings.panelTitle.fontSize}px`,
      `font-weight:${settings.panelTitle.bold ? '700' : '400'}`,
      `text-align:${settings.panelTitle.align}`,
      'overflow:hidden',
      'white-space:nowrap',
      'text-overflow:ellipsis',
      `height:${titleHeight}px`,
      `line-height:${titleHeight}px`,
      'padding:0 4px',
      `color:${settings.panelTitle.color}`,
      'cursor:pointer',
      settings.panelTitle.background ? `background:${settings.panelTitle.background}` : '',
    ].filter(Boolean).join(';');
    const panelItems = panel.groups.flatMap(g => g.items);
    titleEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      onPanelClick(panelItems, e.shiftKey);
    });
    container.appendChild(titleEl);
  }

  if (svgHeight <= 0 || width <= 0) return;

  const root: TreemapDatum = {
    name: panel.title, displayName: panel.title,
    children: panel.groups.map(group => ({
      name: group.title, displayName: group.title,
      rawTotal: group.total,
      children: group.items.map(item => ({
        name:        item.label,
        displayName: item.displayLabel,   // friendly text for rendering
        value:       Math.max(0, item.value),
        colorKey:    item.colorKey,
        rowIndices:  item.rowIndices,
        groupTitle:  group.title,
      })),
    })),
  };

  const sc = settings.values.scale;

  const rootNode = hierarchy<TreemapDatum>(root)
    .sum(d => applyScale(d.value ?? 0, sc))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const labelStripHeight = settings.labels.show ? settings.labels.fontSize + 6 : 2;

  treemap<TreemapDatum>()
    .tile(treemapSquarify)
    .size([width, svgHeight])
    .paddingOuter(3)
    .paddingTop((d: any) => d.depth === 1 ? labelStripHeight : 0)
    .paddingInner(1)
    (rootNode);

  const svgEl = doc.createElementNS(SVG_NS, 'svg');
  svgEl.setAttribute('width',  String(width));
  svgEl.setAttribute('height', String(svgHeight));
  svgEl.addEventListener('click', () => onClearSelection());

  const leaves = rootNode.leaves() as HierarchyRectangularNode<TreemapDatum>[];
  const groups = rootNode.descendants().filter(n => n.depth === 1) as HierarchyRectangularNode<TreemapDatum>[];

  // Draw item leaf blocks first
  for (const leaf of leaves) {
    const lw = Math.max(0, leaf.x1 - leaf.x0);
    const lh = Math.max(0, leaf.y1 - leaf.y0);
    if (lw <= 0 || lh <= 0) continue;

    const fill    = colorManager.getColor(leaf.data.colorKey ?? '');
    const opacity = highlightedLabels === null || highlightedLabels.has(leaf.data.name) ? '1' : '0.3';
    const item: Item = {
      label:        leaf.data.name,
      displayLabel: leaf.data.displayName,
      value:        leaf.data.value ?? 0,
      colorKey:     leaf.data.colorKey ?? '',
      rowIndices:   leaf.data.rowIndices ?? [],
    };
    const groupTitle = leaf.data.groupTitle ?? '';

    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${leaf.x0},${leaf.y0})`);
    g.style.cursor = 'pointer';

    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width',        String(lw));
    rect.setAttribute('height',       String(lh));
    rect.setAttribute('fill',         fill);
    rect.setAttribute('stroke',       'rgba(0,0,0,0.2)');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('opacity',      opacity);
    g.appendChild(rect);

    g.addEventListener('click',       (e: MouseEvent) => { e.stopPropagation(); if (item.rowIndices.length) onItemClick(item, groupTitle, panel.title, e.shiftKey); });
    g.addEventListener('mouseover',  (e: MouseEvent) => onTooltipShow(item, groupTitle, panel.title, e));
    g.addEventListener('mouseleave', ()              => onTooltipHide());
    g.addEventListener('contextmenu',(e: MouseEvent) => { e.preventDefault(); onContextMenu(item, e); });

    svgEl.appendChild(g);
  }

  // Draw item labels (name and/or count) inside leaf blocks
  if (settings.itemLabels.show || settings.itemLabels.showCount) {
    for (let li = 0; li < leaves.length; li++) {
      const leaf = leaves[li];
      const lw = Math.max(0, leaf.x1 - leaf.x0);
      const lh = Math.max(0, leaf.y1 - leaf.y0);
      if (lw < settings.itemLabels.minWidth) continue;

      // Build lines with overflow processing applied per segment
      const allLines: { text: string; fontSize: number }[] = [];
      if (settings.itemLabels.show) {
        const { lines, fontSize } = processLabel(
          leaf.data.displayName ?? '', lw - 6, settings.itemLabels.fontSize, settings.itemLabels.textOverflow);
        lines.forEach(l => allLines.push({ text: l, fontSize }));
      }
      if (settings.itemLabels.showCount) {
        const countStr = String(leaf.data.value ?? 0);
        const { lines, fontSize } = processLabel(
          countStr, lw - 6, settings.itemLabels.fontSize, settings.itemLabels.textOverflow);
        lines.forEach(l => allLines.push({ text: l, fontSize }));
      }
      if (allLines.length === 0) continue;

      const lineH = settings.itemLabels.fontSize + 2;
      if (lh < lineH + 2) continue;  // not even one line fits

      const elClipId = `elc_${panelIndex}_${li}`;
      const elClip   = doc.createElementNS(SVG_NS, 'clipPath');
      elClip.setAttribute('id', elClipId);
      const elCR = doc.createElementNS(SVG_NS, 'rect');
      elCR.setAttribute('x', String(leaf.x0 + 1)); elCR.setAttribute('y', String(leaf.y0 + 1));
      elCR.setAttribute('width', String(lw - 2));  elCR.setAttribute('height', String(lh - 2));
      elClip.appendChild(elCR);
      svgEl.appendChild(elClip);

      const elAlign  = settings.itemLabels.align;
      const elAnchor = elAlign === 'center' ? 'middle' : elAlign === 'right' ? 'end' : 'start';
      const elX      = elAlign === 'center' ? leaf.x0 + lw / 2
                     : elAlign === 'right'  ? leaf.x1 - 3
                     :                        leaf.x0 + 3;

      let yOffset = 0;
      for (const { text, fontSize: efs } of allLines) {
        yOffset += efs + 2;
        if (yOffset > lh - 2) break;  // no room for this line
        const t = doc.createElementNS(SVG_NS, 'text');
        t.setAttribute('x',              String(elX));
        t.setAttribute('y',              String(leaf.y0 + yOffset));
        t.setAttribute('text-anchor',    elAnchor);
        t.setAttribute('font-size',      String(efs));
        t.setAttribute('font-weight',    settings.itemLabels.bold ? '700' : '400');
        t.setAttribute('fill',           settings.itemLabels.color);
        t.setAttribute('pointer-events', 'none');
        t.setAttribute('clip-path',      `url(#${elClipId})`);
        t.textContent = text;
        svgEl.appendChild(t);
      }
    }
  }

  // Draw group labels on top so they're never clipped by item rects
  if (settings.labels.show) {
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const gw = group.x1 - group.x0;
      const gh = group.y1 - group.y0;
      const effectiveMin = Math.max(labelStripHeight, settings.labels.minHeight);
      if (gh < effectiveMin || gw < settings.labels.minWidth) continue;

      const clipId = `glc_${panelIndex}_${gi}`;
      const clipPath = doc.createElementNS(SVG_NS, 'clipPath');
      clipPath.setAttribute('id', clipId);
      const clipRect = doc.createElementNS(SVG_NS, 'rect');
      clipRect.setAttribute('x',      String(group.x0));
      clipRect.setAttribute('y',      String(group.y0));
      clipRect.setAttribute('width',  String(gw));
      clipRect.setAttribute('height', String(labelStripHeight));
      clipPath.appendChild(clipRect);
      svgEl.appendChild(clipPath);

      const fs     = settings.labels.fontSize;
      const fw     = settings.labels.bold ? '700' : '400';
      const lAlign  = settings.labels.align;
      const lAnchor = lAlign === 'center' ? 'middle' : lAlign === 'right' ? 'end' : 'start';
      const lX      = lAlign === 'center' ? group.x0 + gw / 2
                    : lAlign === 'right'  ? group.x1 - 3
                    :                       group.x0 + 3;

      let displayLabel: string;
      let displayFs = fs;

      if (settings.labels.showCount) {
        // Reserve space for " · Count" suffix so the count is never truncated.
        // Name is truncated to fit within the remaining width; the count always shows.
        const countSuffix = ` · ${String(group.data.rawTotal ?? 0)}`;
        const suffixEst   = countSuffix.length * fs * CHAR_W_RATIO;
        const nameMaxW    = Math.max(0, gw - 6 - suffixEst);
        const { lines, fontSize: nfs } =
          processLabel(group.data.name, nameMaxW, fs, settings.labels.textOverflow);
        displayLabel = (lines[0] ?? '') + countSuffix;
        displayFs    = nfs;
      } else {
        const { lines, fontSize: lfs } =
          processLabel(group.data.name, gw - 6, fs, settings.labels.textOverflow);
        if (lines.length === 0) continue;
        displayLabel = lines[0];
        displayFs    = lfs;
      }

      const text = doc.createElementNS(SVG_NS, 'text');
      text.setAttribute('x',              String(lX));
      text.setAttribute('y',              String(group.y0 + displayFs));
      text.setAttribute('text-anchor',    lAnchor);
      text.setAttribute('font-size',      String(displayFs));
      text.setAttribute('font-weight',    fw);
      text.setAttribute('fill',           settings.labels.color);
      text.setAttribute('pointer-events', 'none');
      text.setAttribute('clip-path',      `url(#${clipId})`);
      text.textContent = displayLabel;
      svgEl.appendChild(text);
    }
  }

  // Transparent click targets over each group's label strip — always present regardless of labels.show
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const gw = group.x1 - group.x0;
    const gh = group.y1 - group.y0;
    if (gw <= 0 || gh <= 0) continue;
    const groupItems: Item[] = (group.children ?? []).map(leaf => ({
      label:        leaf.data.name,
      displayLabel: leaf.data.displayName,
      value:        leaf.data.value ?? 0,
      colorKey:     leaf.data.colorKey ?? '',
      rowIndices:   leaf.data.rowIndices ?? [],
    }));
    const gClickRect = doc.createElementNS(SVG_NS, 'rect');
    gClickRect.setAttribute('x',      String(group.x0));
    gClickRect.setAttribute('y',      String(group.y0));
    gClickRect.setAttribute('width',  String(gw));
    gClickRect.setAttribute('height', String(Math.min(labelStripHeight, gh)));
    gClickRect.setAttribute('fill',   'transparent');
    gClickRect.style.cursor = 'pointer';
    gClickRect.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      onGroupClick(groupItems, e.shiftKey);
    });
    svgEl.appendChild(gClickRect);
  }

  container.appendChild(svgEl);
}

export class Visual implements IVisual {
  private host: IVisualHost;
  private container: HTMLElement;
  private selectionManager: powerbi.extensibility.ISelectionManager;
  private lastOptions:        VisualUpdateOptions | null = null;
  private lastDataView:       powerbi.DataView | undefined;
  private lastSettings:       VisualSettings = DEFAULT_SETTINGS;
  private lastMeasureName:    string = 'Value';
  private lastColorKeys:      string[] = [];
  private selectedLabels:     Set<string> = new Set();
  private lastColorManager:   ColorManager | null = null;
  private tooltipEl:          HTMLElement | null = null;
  private tooltipHideTimer:   ReturnType<typeof setTimeout> | null = null;
  private modalOverlay:       HTMLElement | null = null;
  private modalTitleEl:       HTMLElement | null = null;
  private modalBodyEl:        HTMLElement | null = null;

  constructor(options: VisualConstructorOptions) {
    this.host = options.host;
    this.selectionManager = options.host.createSelectionManager();

    const doc = options.element.ownerDocument ?? document;
    this.container = doc.createElement('div');
    this.container.style.cssText = 'width:100%;height:100%;overflow-y:auto;box-sizing:border-box;display:flex;flex-wrap:wrap;align-content:flex-start;';
    options.element.appendChild(this.container);

    // Persistent tooltip element — created once, lives on the iframe body
    const tip = doc.createElement('div');
    tip.style.cssText = [
      'position:fixed', 'display:none', 'z-index:99999', 'pointer-events:auto',
      'background:#ffffff', 'border:1px solid #e0e0e0', 'border-radius:4px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.18)', 'font-size:12px',
      'min-width:160px', 'max-width:360px', 'overflow-y:auto', 'overflow-x:hidden',
    ].join(';');
    tip.addEventListener('mouseenter', () => this.cancelTooltipHide());
    tip.addEventListener('mouseleave', () => this.scheduleTooltipHide());
    doc.body.appendChild(tip);
    this.tooltipEl = tip;

    // ── Detail popup modal ──────────────────────────────────────────────────
    const overlay = doc.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'background:rgba(0,0,0,0.45)', 'z-index:100000',
      'display:none', 'align-items:center', 'justify-content:center',
    ].join(';');
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) this.hideModal();
    });

    const card = doc.createElement('div');
    card.style.cssText = [
      'background:#ffffff', 'border-radius:8px',
      'box-shadow:0 12px 48px rgba(0,0,0,0.28)',
      'min-width:280px', 'max-width:520px', 'width:88%',
      'max-height:82vh', 'display:flex', 'flex-direction:column',
      'overflow:hidden',
    ].join(';');
    card.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

    // Header
    const header = doc.createElement('div');
    header.style.cssText = [
      'display:flex', 'align-items:flex-start', 'gap:12px',
      'padding:16px 20px', 'border-bottom:1px solid #ebebeb',
      'background:#fafafa', 'flex-shrink:0',
    ].join(';');

    const titleEl = doc.createElement('div');
    titleEl.style.cssText = 'flex:1;font-size:14px;font-weight:600;color:#1f1f1f;line-height:1.4;word-break:break-word;';
    this.modalTitleEl = titleEl;

    const closeBtn = doc.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = [
      'background:none', 'border:none', 'cursor:pointer',
      'font-size:13px', 'color:#888', 'padding:2px 6px',
      'border-radius:4px', 'flex-shrink:0', 'line-height:1',
      'margin-top:1px',
    ].join(';');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#ebebeb'; closeBtn.style.color = '#333'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'none';    closeBtn.style.color = '#888'; });
    closeBtn.addEventListener('click', () => this.hideModal());

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Scrollable body
    const body = doc.createElement('div');
    body.style.cssText = 'padding:16px 20px 20px;overflow-y:auto;flex:1;';
    this.modalBodyEl = body;

    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(card);
    doc.body.appendChild(overlay);
    this.modalOverlay = overlay;

    // Escape key dismisses
    doc.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hideModal();
    });
  }

  public update(options: VisualUpdateOptions): void {
    this.lastOptions = options;
    const dataView: DataView | undefined = options.dataViews?.[0];
    const { width, height } = options.viewport;

    this.lastDataView = dataView;
    const settings: VisualSettings = parseSettings(dataView);
    this.lastSettings = settings;
    this.lastMeasureName = getMeasureName(dataView);

    // Update cached color keys — but only when we actually have data so
    // getFormattingModel() never sees a stale-empty list after a field change
    const freshKeys = getUniqueColorKeys(dataView);
    if (freshKeys.length > 0) this.lastColorKeys = freshKeys;

    const panels: Panel[] = transformDataView(dataView);
    const colorManager    = new ColorManager(this.host.colorPalette, settings.colorMapping);
    this.lastColorManager = colorManager;
    const pad             = settings.grid.padding;

    let highlightedLabels: Set<string> | null = null;
    if (dataView?.table) {
      const labelCol = dataView.table.columns.find(c => c.roles?.['label']);
      if (labelCol) {
        const highlights = (dataView.table as any).highlights as (number | null)[] | undefined;
        if (highlights?.some(h => h !== null)) {
          highlightedLabels = new Set<string>();
          dataView.table.rows.forEach((row, i) => {
            if (highlights[i] !== null) {
              highlightedLabels!.add(String(row[labelCol.index] ?? ''));
            }
          });
        }
      }
    }
    // When no PBI highlights are present, use our own selection state for visual feedback.
    // selectionManager.select() cross-filters other visuals but does not send highlights
    // back to the originating visual, so we track the selected set ourselves.
    if (highlightedLabels === null && this.selectedLabels.size > 0) {
      highlightedLabels = new Set(this.selectedLabels);
    }

    while (this.container.firstChild) this.container.removeChild(this.container.firstChild);
    this.container.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden;box-sizing:border-box;';

    const doc = this.container.ownerDocument;
    const leg = settings.legend;

    // Legend: allocate space at the chosen edge, then render it
    const colorByName = dataView?.table?.columns?.find(c => c.roles?.['colorBy'])?.displayName ?? 'Legend';
    const isHorizLeg  = leg.position === 'top' || leg.position === 'bottom';
    const legH = isHorizLeg
      ? (leg.showTitle ? leg.titleFontSize + 6 : 0) + leg.fontSize + 20 : 0;
    const legW = !isHorizLeg ? 160 : 0;

    let cx = 0, cy = 0, cw = width, ch = height;
    if (leg.show && this.lastColorKeys.length > 0) {
      if      (leg.position === 'top')    { cy += legH; ch -= legH; }
      else if (leg.position === 'bottom') { ch -= legH; }
      else if (leg.position === 'left')   { cx += legW; cw -= legW; }
      else if (leg.position === 'right')  { cw -= legW; }

      const lx = leg.position === 'right'  ? width - legW : 0;
      const ly = leg.position === 'bottom' ? height - legH : 0;
      const lw = isHorizLeg ? width : legW;
      const lh = isHorizLeg ? legH  : height;

      const legEl = doc.createElement('div');
      legEl.style.cssText = `position:absolute;left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:4px 8px;box-sizing:border-box;`;

      if (leg.showTitle) {
        const titleDiv = doc.createElement('div');
        titleDiv.textContent = colorByName;
        titleDiv.style.cssText = `font-size:${leg.titleFontSize}px;font-weight:${leg.titleBold ? '700' : '400'};color:${leg.titleColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;`;
        legEl.appendChild(titleDiv);
      }

      const itemsDiv = doc.createElement('div');
      itemsDiv.style.cssText = `display:flex;flex-direction:${isHorizLeg ? 'row' : 'column'};flex-wrap:wrap;align-items:${isHorizLeg ? 'center' : 'flex-start'};gap:${isHorizLeg ? '16px' : '6px'};overflow:hidden;`;
      this.lastColorKeys.forEach(key => {
        const item = doc.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const swatch = doc.createElement('div');
        swatch.style.cssText = `width:${leg.fontSize}px;height:${leg.fontSize}px;border-radius:2px;flex-shrink:0;background:${colorManager.getColor(key)};`;
        const label = doc.createElement('span');
        label.textContent = key;
        label.style.cssText = `font-size:${leg.fontSize}px;font-weight:${leg.bold ? '700' : '400'};color:${leg.color};white-space:nowrap;`;
        item.appendChild(swatch);
        item.appendChild(label);
        itemsDiv.appendChild(item);
      });
      legEl.appendChild(itemsDiv);
      this.container.appendChild(legEl);
    }

    // Chart area (accounts for legend space)
    const chartArea = doc.createElement('div');
    chartArea.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;overflow:hidden;`;
    this.container.appendChild(chartArea);

    const renderCall = (cell: HTMLElement, panel: Panel, cellW: number, cellH: number, panelIndex: number) =>
      renderPanel(cell, panel, cellW, cellH, settings, colorManager,
        (item, groupTitle, panelTitle, shiftKey) => this.handleItemClick(item, groupTitle, panelTitle, dataView, shiftKey),
        highlightedLabels,
        (item, groupTitle, panelTitle, event) => this.showTooltip(item, groupTitle, panelTitle, event),
        () => this.hideTooltip(),
        (item, event) => this.showContextMenu(item, dataView, event),
        (items, shiftKey) => this.handleGroupClick(items, dataView, shiftKey),
        (items, shiftKey) => this.handlePanelClick(items, dataView, shiftKey),
        () => this.clearSelection(),
        doc, panelIndex);


    // Panel border: use box-shadow inset so it draws inside the cell and never
    // merges with adjacent panels the way a CSS border would.
    const pb = settings.panelBorder;
    const pbW = pb.show && pb.width > 0 ? pb.width : 0;
    const pbStyle = pbW > 0 ? `box-shadow:inset 0 0 0 ${pbW}px ${pb.color};` : '';

    if (settings.grid.columns === 0) {
      // Proportional layout.
      // Panel areas use sum(applyScale(each_block)) — the same scaling the inner
      // treemap uses — so block areas are globally consistent across all panels.
      // A block with value 60 will always render larger than a block with value 20 regardless
      // of which panel they belong to.
      const sc2 = settings.values.scale;
      const panelScaledTotal = (p: Panel) =>
        p.groups.reduce((gs, g) =>
          gs + g.items.reduce((es, e) => es + applyScale(Math.max(0, e.value), sc2), 0), 0);

      interface PanelDatum { panel?: Panel; value: number; children?: PanelDatum[] }
      const panelRoot = hierarchy<PanelDatum>({
        value: 0,
        children: panels.map(p => ({
          panel: p,
          value: Math.max(0.001, panelScaledTotal(p)),
        })),
      }).sum(d => d.children ? 0 : d.value);

      treemap<PanelDatum>()
        .tile(treemapBinary)
        .size([cw, ch])
        .paddingInner(pad)
        (panelRoot);

      (panelRoot.leaves() as HierarchyRectangularNode<PanelDatum>[]).forEach((leaf, panelIndex) => {
        const cellW = Math.max(1, leaf.x1 - leaf.x0);
        const cellH = Math.max(1, leaf.y1 - leaf.y0);
        const cell  = doc.createElement('div');
        cell.style.cssText = `position:absolute;left:${leaf.x0}px;top:${leaf.y0}px;width:${cellW}px;height:${cellH}px;overflow:hidden;${pbStyle}`;
        chartArea.appendChild(cell);
        const contentW = Math.max(1, cellW - 2 * pbW);
        const contentH = Math.max(1, cellH - 2 * pbW);
        renderCall(cell, leaf.data.panel!, contentW, contentH, panelIndex);
      });

    } else {
      // Fixed grid layout
      chartArea.style.cssText += `;display:flex;flex-wrap:wrap;align-content:flex-start;padding:${pad}px;gap:${pad}px;`;
      const cols   = settings.grid.columns;
      const rows   = Math.ceil(panels.length / cols);
      const panelW = Math.max(1, Math.floor((cw - pad * (cols + 1)) / cols));
      const panelH = Math.max(1, Math.floor((ch - pad * (rows + 1)) / rows));

      panels.forEach((panel, panelIndex) => {
        const cell = doc.createElement('div');
        cell.style.cssText = `width:${panelW}px;height:${panelH}px;overflow:hidden;flex-shrink:0;${pbStyle}`;
        chartArea.appendChild(cell);
        const contentW = Math.max(1, panelW - 2 * pbW);
        const contentH = Math.max(1, panelH - 2 * pbW);
        renderCall(cell, panel, contentW, contentH, panelIndex);
      });
    }
  }

  private handleItemClick(item: Item, groupTitle: string, panelTitle: string, dataView: DataView | undefined, shiftKey: boolean): void {
    if (this.lastSettings.detailPopup.enabled && !shiftKey) {
      this.showModal(item, groupTitle, panelTitle, dataView);
      return;
    }
    this.selectItems([item], dataView, shiftKey);
  }

  private handleGroupClick(items: Item[], dataView: DataView | undefined, shiftKey: boolean): void {
    this.selectItems(items, dataView, shiftKey);
  }

  private handlePanelClick(items: Item[], dataView: DataView | undefined, shiftKey: boolean): void {
    this.selectItems(items, dataView, shiftKey);
  }

  private clearSelection(): void {
    this.selectedLabels.clear();
    void this.selectionManager.clear();
    this.rerender();
  }

  private rerender(): void {
    if (this.lastOptions) this.update(this.lastOptions);
  }

  /** Selects a set of items, updating selectedLabels and firing selectionManager. */
  private selectItems(items: Item[], dataView: DataView | undefined, shiftKey: boolean): void {
    if (!dataView?.table) return;
    const clickedLabels = items.map(e => e.label);

    if (shiftKey) {
      const allAlreadySelected = clickedLabels.every(l => this.selectedLabels.has(l));
      if (allAlreadySelected) {
        clickedLabels.forEach(l => this.selectedLabels.delete(l));
      } else {
        clickedLabels.forEach(l => this.selectedLabels.add(l));
      }
    } else {
      const alreadySolo = this.selectedLabels.size === clickedLabels.length
        && clickedLabels.every(l => this.selectedLabels.has(l));
      if (alreadySolo) {
        this.selectedLabels.clear();
        void this.selectionManager.clear();
        this.rerender();
        return;
      }
      this.selectedLabels = new Set(clickedLabels);
    }

    if (this.selectedLabels.size === 0) {
      void this.selectionManager.clear();
      this.rerender();
      return;
    }

    // Build selection IDs for all rows whose label is in selectedLabels
    const labelColIdx = dataView.table.columns.findIndex(c => c.roles?.['label']);
    if (labelColIdx === -1) return;
    const ids = dataView.table.rows
      .map((row, i) => ({ label: String(row[labelColIdx] ?? ''), i }))
      .filter(({ label }) => this.selectedLabels.has(label))
      .map(({ i }) =>
        this.host.createSelectionIdBuilder()
          .withTable(dataView.table!, i)
          .createSelectionId()
      );
    if (ids.length) void this.selectionManager.select(ids, false);
    this.rerender();
  }

  /** Applies a JSON filter for an item — used only when the detail popup is open to cross-filter related visuals. */
  private applyItemJsonFilter(item: Item, dataView: DataView | undefined): void {
    if (!dataView?.table) return;
    const labelCol = dataView.table.columns.find(c => c.roles?.['label']);
    if (!labelCol?.queryName) return;
    const qn  = labelCol.queryName;
    const dot  = qn.lastIndexOf('.');
    const tbl  = dot > 0 ? qn.substring(0, dot)  : qn;
    const col  = dot > 0 ? qn.substring(dot + 1) : qn;
    const filter = {
      $schema:    'https://powerbi.com/product/schema#basic',
      target:     { table: tbl, column: col },
      operator:   'In',
      values:     [item.label],
      filterType: 1,
    };
    this.host.applyJsonFilter(filter as any, 'general', 'filter', powerbi.FilterAction.merge);
  }

  private showModal(item: Item, groupTitle: string, panelTitle: string, dataView: DataView | undefined): void {
    if (!this.modalOverlay || !this.modalTitleEl || !this.modalBodyEl) return;
    const doc = this.container.ownerDocument;

    // Title
    this.modalTitleEl.textContent = item.displayLabel;

    // Clear body
    while (this.modalBodyEl.firstChild) this.modalBodyEl.removeChild(this.modalBodyEl.firstChild);

    // Status badge row (coloured swatch + status text)
    if (item.colorKey) {
      const badgeRow = doc.createElement('div');
      badgeRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';
      const swatch = doc.createElement('span');
      swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:2px;flex-shrink:0;background:${this.lastColorManager?.getColor(item.colorKey) ?? '#ccc'};`;
      const statusTxt = doc.createElement('span');
      statusTxt.textContent = item.colorKey;
      statusTxt.style.cssText = 'font-size:12px;color:#555;font-weight:500;';
      badgeRow.appendChild(swatch);
      badgeRow.appendChild(statusTxt);
      this.modalBodyEl.appendChild(badgeRow);
    }

    // Build field list
    interface Field { label: string; value: string }
    const fields: Field[] = [
      { label: 'Panel',   value: panelTitle   },
      { label: 'Section', value: groupTitle   },
      { label: this.lastMeasureName, value: String(item.value) },
    ];
    if (item.displayLabel !== item.label) {
      fields.push({ label: 'Original Name', value: item.label });
    }
    // Tooltip-well extra fields
    const dv = dataView ?? this.lastDataView;
    if (dv?.table && item.rowIndices.length > 0) {
      const tipCols = dv.table.columns.filter(c => c.roles?.['tooltips']);
      const row = dv.table.rows[item.rowIndices[0]];
      tipCols.forEach(col => {
        const raw = row?.[col.index];
        if (raw != null && String(raw) !== '') {
          fields.push({ label: col.displayName, value: String(raw) });
        }
      });
    }

    // Render as a clean table
    const tbl = doc.createElement('table');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
    fields.forEach(({ label, value }, idx) => {
      const tr = doc.createElement('tr');
      if (idx < fields.length - 1) tr.style.borderBottom = '1px solid #f3f3f3';
      const tdL = doc.createElement('td');
      tdL.textContent = label;
      tdL.style.cssText = 'padding:8px 14px 8px 0;color:#999;font-weight:500;white-space:nowrap;vertical-align:top;width:38%;';
      const tdR = doc.createElement('td');
      tdR.textContent = value;
      tdR.style.cssText = 'padding:8px 0;color:#1f1f1f;word-break:break-word;line-height:1.45;';
      tr.appendChild(tdL);
      tr.appendChild(tdR);
      tbl.appendChild(tr);
    });
    this.modalBodyEl.appendChild(tbl);

    // Show overlay
    this.modalOverlay.style.display = 'flex';

    // Cross-filter so related visuals (matrix, etc.) update while the popup is open
    this.applyItemJsonFilter(item, dataView);
  }

  private hideModal(): void {
    if (this.modalOverlay) this.modalOverlay.style.display = 'none';
    // Clear cross-filter when popup is dismissed so everything returns to full view
    this.host.applyJsonFilter(null, 'general', 'filter', powerbi.FilterAction.remove);
  }

  /** Builds the tooltip row data — shared by both native and custom tooltip paths. */
  private buildTooltipItems(item: Item, groupTitle: string, panelTitle: string): powerbi.extensibility.VisualTooltipDataItem[] {
    const items: powerbi.extensibility.VisualTooltipDataItem[] = [
      { displayName: 'Panel',    value: panelTitle         },
      { displayName: 'Section',  value: groupTitle         },
      { displayName: 'Name',     value: item.displayLabel  },
      { displayName: this.lastMeasureName, value: String(item.value) },
      { displayName: 'Category', value: item.colorKey      },
    ];
    if (item.displayLabel !== item.label) {
      items.push({ displayName: 'Original Name', value: item.label });
    }
    const dv = this.lastDataView;
    if (dv?.table && item.rowIndices.length > 0) {
      const tooltipCols = dv.table.columns.filter(c => c.roles?.['tooltips']);
      const row = dv.table.rows[item.rowIndices[0]];
      tooltipCols.forEach(col => {
        const raw = row?.[col.index];
        items.push({ displayName: col.displayName, value: raw != null ? String(raw) : '' });
      });
    }
    return items;
  }

  private showTooltip(item: Item, groupTitle: string, panelTitle: string, event: MouseEvent): void {
    const items = this.buildTooltipItems(item, groupTitle, panelTitle);

    if (this.lastSettings.tooltipBehavior.persistent) {
      // Custom sticky tooltip — stays open when mouse moves onto it
      this.cancelTooltipHide();
      this.renderPersistentTooltip(items, event.clientX, event.clientY);
    } else {
      // Native Power BI tooltip — supports report-page tooltips
      const dv = this.lastDataView;
      const identities: powerbi.extensibility.ISelectionId[] = [];
      if (dv?.table && item.rowIndices.length > 0) {
        identities.push(
          this.host.createSelectionIdBuilder()
            .withTable(dv.table, item.rowIndices[0])
            .createSelectionId()
        );
      }
      this.host.tooltipService.show({
        dataItems:    items,
        identities,
        coordinates:  [event.clientX, event.clientY],
        isTouchEvent: false,
      });
    }
  }

  private hideTooltip(): void {
    if (this.lastSettings.tooltipBehavior.persistent) {
      this.scheduleTooltipHide();
    } else {
      this.host.tooltipService.hide({ immediately: false, isTouchEvent: false });
    }
  }

  private renderPersistentTooltip(items: powerbi.extensibility.VisualTooltipDataItem[], cx: number, cy: number): void {
    const tip = this.tooltipEl;
    if (!tip) return;
    const doc = this.container.ownerDocument;

    // Max height from settings
    const maxH = Math.max(80, this.lastSettings.tooltipBehavior.maxHeight);
    tip.style.maxHeight = maxH + 'px';

    // Build content as a simple table
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    const tbl = doc.createElement('table');
    tbl.style.cssText = 'border-collapse:collapse;width:100%;';

    items.forEach((item, idx) => {
      const tr = doc.createElement('tr');
      if (idx < items.length - 1) {
        tr.style.borderBottom = '1px solid #f2f2f2';
      }
      const tdL = doc.createElement('td');
      tdL.textContent = item.displayName;
      tdL.style.cssText = 'padding:5px 6px 5px 12px;color:#888;font-weight:600;white-space:nowrap;vertical-align:top;';

      const tdR = doc.createElement('td');
      tdR.textContent = item.value ?? '';
      tdR.style.cssText = 'padding:5px 12px 5px 6px;color:#222;word-break:break-word;';

      tr.appendChild(tdL);
      tr.appendChild(tdR);
      tbl.appendChild(tr);
    });
    tip.appendChild(tbl);
    tip.style.display = 'block';

    // Position near cursor; flip to stay within viewport
    const vw = doc.defaultView?.innerWidth  ?? 800;
    const vh = doc.defaultView?.innerHeight ?? 600;
    const gap = 14;
    tip.style.left = (cx + gap) + 'px';
    tip.style.top  = (cy + gap) + 'px';

    // Read actual size after paint and flip if overflowing
    requestAnimationFrame(() => {
      const r = tip.getBoundingClientRect();
      if (r.right  > vw - gap) tip.style.left = (cx - r.width  - gap) + 'px';
      if (r.bottom > vh - gap) tip.style.top  = (cy - r.height - gap) + 'px';
    });
  }

  private scheduleTooltipHide(): void {
    this.tooltipHideTimer = setTimeout(() => {
      if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }, 150);
  }

  private cancelTooltipHide(): void {
    if (this.tooltipHideTimer !== null) {
      clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }
  }

  private showContextMenu(item: Item, dataView: DataView | undefined, event: MouseEvent): void {
    if (!dataView?.table || item.rowIndices.length === 0) return;
    const identity = this.host.createSelectionIdBuilder()
      .withTable(dataView.table, item.rowIndices[0])
      .createSelectionId();
    void this.selectionManager.showContextMenu(identity, { x: event.clientX, y: event.clientY });
  }

  public enumerateObjectInstances(options: powerbi.EnumerateVisualObjectInstancesOptions): powerbi.VisualObjectInstanceEnumeration {
    return enumerateInstances(options, this.lastDataView, this.host, this.lastSettings);
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    const s    = this.lastSettings;
    // Use cached keys — never empty after first update(), survives field-well changes
    const keys = this.lastColorKeys;

    const colorPicker = (uid: string, label: string, obj: string, prop: string, hex: string): powerbi.visuals.SimpleVisualFormattingSlice => ({
      uid,
      displayName: label,
      control: { type: 'ColorPicker', properties: {
        descriptor: { objectName: obj, propertyName: prop },
        value: { value: hex },
      }} as any,
    });

    const numSlice = (uid: string, label: string, obj: string, prop: string, val: number): powerbi.visuals.SimpleVisualFormattingSlice => ({
      uid,
      displayName: label,
      control: { type: 'NumUpDown', properties: {
        descriptor: { objectName: obj, propertyName: prop },
        value: val,
      }} as any,
    });

    const toggleSlice = (uid: string, label: string, obj: string, prop: string, val: boolean): powerbi.visuals.SimpleVisualFormattingSlice => ({
      uid,
      displayName: label,
      control: { type: 'ToggleSwitch', properties: {
        descriptor: { objectName: obj, propertyName: prop },
        value: val,
      }} as any,
    });

    const dropdownSlice = (uid: string, label: string, obj: string, prop: string, val: string, items: {value: string; displayName: string}[]): powerbi.visuals.SimpleVisualFormattingSlice => ({
      uid,
      displayName: label,
      control: { type: 'Dropdown', properties: {
        descriptor: { objectName: obj, propertyName: prop },
        value:       { value: val, displayName: items.find(i => i.value === val)?.displayName ?? val },
        items,
      }} as any,
    });

    const alignItems = [
      { value: 'left',   displayName: 'Left'   },
      { value: 'center', displayName: 'Center' },
      { value: 'right',  displayName: 'Right'  },
    ];
    const overflowItems = [
      { value: 'clip',     displayName: 'Clip'           },
      { value: 'ellipsis', displayName: 'Truncate (…)'   },
      { value: 'wrap',     displayName: 'Word Wrap'      },
      { value: 'resize',   displayName: 'Resize to Fit'  },
    ];

    const colorSlices = keys.map(key => {
      const safe = key.replace(/[^a-zA-Z0-9]/g, '_');
      return colorPicker(`sc_${safe}`, key, `colorSlot${slotIndex(key)}`, 'fill',
        s.colorMapping.get(key) ?? this.host.colorPalette.getColor(key).value);
    });

    return {
      cards: [
        // 1. Data colors
        {
          uid: 'statusColors', displayName: 'Data Colors',
          groups: [{ uid: 'statusColorsGrp', displayName: '', slices: colorSlices }],
        },
        // 2. Title
        {
          uid: 'panelTitle', displayName: 'Title',
          groups: [{ uid: 'ptGrp', displayName: '', slices: [
            toggleSlice  ('pt_show',  'Show',             'panelTitle', 'show',       s.panelTitle.show),
            numSlice     ('pt_fs',    'Font Size',         'panelTitle', 'fontSize',   s.panelTitle.fontSize),
            toggleSlice  ('pt_bold',  'Bold',              'panelTitle', 'bold',       s.panelTitle.bold),
            dropdownSlice('pt_align', 'Alignment',         'panelTitle', 'align',      s.panelTitle.align,  alignItems),
            colorPicker  ('pt_color', 'Font Color',        'panelTitle', 'color',      s.panelTitle.color),
            colorPicker  ('pt_bg',    'Background Color',  'panelTitle', 'background', s.panelTitle.background || '#000000'),
          ]}],
        },
        // 3. Group Labels
        {
          uid: 'labels', displayName: 'Group Labels',
          groups: [{ uid: 'lblGrp', displayName: '', slices: [
            toggleSlice  ('lbl_show',  'Show',                          'labels', 'show',         s.labels.show),
            toggleSlice  ('lbl_cnt',   'Show Count',                    'labels', 'showCount',    s.labels.showCount),
            numSlice     ('lbl_fs',    'Font Size',                     'labels', 'fontSize',     s.labels.fontSize),
            toggleSlice  ('lbl_bold',  'Bold',                          'labels', 'bold',         s.labels.bold),
            dropdownSlice('lbl_align', 'Alignment',                     'labels', 'align',        s.labels.align,        alignItems),
            colorPicker  ('lbl_color', 'Font Color',                    'labels', 'color',        s.labels.color),
            dropdownSlice('lbl_ovfl',  'Text Overflow',                 'labels', 'textOverflow', s.labels.textOverflow, overflowItems),
            numSlice     ('lbl_mh',    'Min Tile Height to Show Label', 'labels', 'minHeight',    s.labels.minHeight),
            numSlice     ('lbl_mw',    'Min Tile Width to Show Label',  'labels', 'minWidth',     s.labels.minWidth),
          ]}],
        },
        // 4. Item Labels
        {
          uid: 'itemLabels', displayName: 'Item Labels',
          groups: [{ uid: 'elGrp', displayName: '', slices: [
            toggleSlice  ('il_show',  'Show Name',              'itemLabels', 'show',         s.itemLabels.show),
            toggleSlice  ('il_cnt',   'Show Count',             'itemLabels', 'showCount',    s.itemLabels.showCount),
            numSlice     ('il_fs',    'Font Size',              'itemLabels', 'fontSize',     s.itemLabels.fontSize),
            toggleSlice  ('il_bold',  'Bold',                   'itemLabels', 'bold',         s.itemLabels.bold),
            dropdownSlice('il_align', 'Alignment',              'itemLabels', 'align',        s.itemLabels.align,        alignItems),
            colorPicker  ('il_color', 'Font Color',             'itemLabels', 'color',        s.itemLabels.color),
            dropdownSlice('il_ovfl',  'Text Overflow',          'itemLabels', 'textOverflow', s.itemLabels.textOverflow, overflowItems),
            numSlice     ('il_mw',    'Min Block Width to Show','itemLabels', 'minWidth',     s.itemLabels.minWidth),
          ]}],
        },
        // 5. Legend
        {
          uid: 'legend', displayName: 'Legend',
          groups: [{ uid: 'legGrp', displayName: '', slices: [
            toggleSlice  ('leg_show',  'Show',     'legend', 'show',     s.legend.show),
            dropdownSlice('leg_pos',   'Position', 'legend', 'position', s.legend.position, [
              { value: 'top',    displayName: 'Top'    },
              { value: 'bottom', displayName: 'Bottom' },
              { value: 'left',   displayName: 'Left'   },
              { value: 'right',  displayName: 'Right'  },
            ]),
            numSlice     ('leg_fs',    'Font Size',  'legend', 'fontSize', s.legend.fontSize),
            toggleSlice  ('leg_bold',  'Bold',       'legend', 'bold',     s.legend.bold),
            colorPicker  ('leg_color', 'Font Color', 'legend', 'color',    s.legend.color),
            toggleSlice  ('leg_tshow', 'Show Title',       'legend', 'showTitle',     s.legend.showTitle),
            numSlice     ('leg_tfs',   'Title Font Size',  'legend', 'titleFontSize', s.legend.titleFontSize),
            toggleSlice  ('leg_tbold', 'Title Bold',       'legend', 'titleBold',     s.legend.titleBold),
            colorPicker  ('leg_tc',    'Title Font Color', 'legend', 'titleColor',    s.legend.titleColor),
          ]}],
        },
        // 6. Grid
        {
          uid: 'grid', displayName: 'Grid',
          groups: [{ uid: 'gridGrp', displayName: '', slices: [
            numSlice('grid_cols', 'Columns (0 = proportional, N = grid)', 'grid', 'columns', s.grid.columns),
            numSlice('grid_pad',  'Panel Padding (px)',                   'grid', 'padding', s.grid.padding),
          ]}],
        },
        // 7. Values
        {
          uid: 'values', displayName: 'Values',
          groups: [{ uid: 'valGrp', displayName: '', slices: [
            dropdownSlice('val_scale', 'Size Scale', 'values', 'scale', s.values.scale, [
              { value: 'linear', displayName: 'Linear (exact)' },
              { value: 'sqrt',   displayName: 'Square Root (recommended)' },
              { value: 'log',    displayName: 'Logarithmic (most even)' },
            ]),
          ]}],
        },
        // 8. Detail Popup
        {
          uid: 'detailPopup', displayName: 'Detail Popup',
          groups: [{ uid: 'dpGrp', displayName: '', slices: [
            toggleSlice('dp_enabled', 'Show detail popup on click', 'detailPopup', 'enabled', s.detailPopup.enabled),
          ]}],
        },
        // 9. Tooltip Options
        {
          uid: 'tooltipBehavior', displayName: 'Tooltip Options',
          groups: [{ uid: 'tipGrp', displayName: '', slices: [
            toggleSlice('tip_persist',  'Persistent (Sticky)',
              'tooltipBehavior', 'persistent', s.tooltipBehavior.persistent),
            numSlice   ('tip_maxh',     'Max Height (px)',
              'tooltipBehavior', 'maxHeight',  s.tooltipBehavior.maxHeight),
          ]}],
        },
        // 9. Panel Border
        {
          uid: 'panelBorder', displayName: 'Panel Border',
          groups: [{ uid: 'pbGrp', displayName: '', slices: [
            toggleSlice  ('pb_show',  'Show',       'panelBorder', 'show',  s.panelBorder.show),
            numSlice     ('pb_width', 'Width (px)', 'panelBorder', 'width', s.panelBorder.width),
            colorPicker  ('pb_color', 'Color',      'panelBorder', 'color', s.panelBorder.color),
          ]}],
        },
      ],
    };
  }
}
