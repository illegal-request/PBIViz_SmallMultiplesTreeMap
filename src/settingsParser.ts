import { VisualSettings, DEFAULT_SETTINGS, Alignment, LegendPosition, TextOverflow } from './types';

const MAX_COLOR_SLOTS = 12;

function getFillColor(obj: any, group: string, prop: string, fallback: string): string {
  const val = obj?.[group]?.[prop];
  return (val as any)?.solid?.color ?? fallback;
}

function getAlign(obj: any, group: string, fallback: Alignment): Alignment {
  const v = String(obj?.[group]?.['align'] ?? '');
  return (['left', 'center', 'right'].includes(v) ? v : fallback) as Alignment;
}

function getLegendPos(obj: any, fallback: LegendPosition): LegendPosition {
  const v = String(obj?.['legend']?.['position'] ?? '');
  return (['top', 'bottom', 'left', 'right'].includes(v) ? v : fallback) as LegendPosition;
}

function getTextOverflow(obj: any, group: string, fallback: TextOverflow): TextOverflow {
  const v = String(obj?.[group]?.['textOverflow'] ?? '');
  return (['clip', 'ellipsis', 'wrap', 'resize'].includes(v) ? v : fallback) as TextOverflow;
}

/** Stable hash: status-code string → fixed slot index (0–11). */
function slotIndex(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (((h << 5) + h) ^ key.charCodeAt(i)) >>> 0;
  return h % MAX_COLOR_SLOTS;
}

export function getUniqueColorKeys(dataView: powerbi.DataView | undefined): string[] {
  if (!dataView?.table) return [];
  let colorByIdx = -1;
  dataView.table.columns.forEach((col, i) => {
    if (col.roles?.['colorBy']) colorByIdx = i;
  });
  if (colorByIdx === -1) return [];
  const seen = new Set<string>();
  dataView.table.rows.forEach(row => {
    const raw = String(row[colorByIdx] ?? '');
    seen.add(raw !== '' ? raw : '(Blank)');
  });
  return Array.from(seen).sort();
}

export function parseSettings(dataView: powerbi.DataView | undefined): VisualSettings {
  const obj = dataView?.metadata?.objects;

  const getNum  = (g: string, p: string, fb: number)  => Number(obj?.[g]?.[p]  ?? fb);
  const getBool = (g: string, p: string, fb: boolean) => {
    const v = obj?.[g]?.[p];
    return v !== undefined ? Boolean(v) : fb;
  };

  const colorMap = new Map<string, string>();
  getUniqueColorKeys(dataView).forEach(key => {
    const fill = (obj?.[`colorSlot${slotIndex(key)}`]?.['fill'] as any)?.solid?.color as string | undefined;
    if (fill) colorMap.set(key, fill);
  });

  const rawScale = String(obj?.['values']?.['scale'] ?? DEFAULT_SETTINGS.values.scale);
  const scale    = (['linear', 'sqrt', 'log'].includes(rawScale)
    ? rawScale : DEFAULT_SETTINGS.values.scale) as 'linear' | 'sqrt' | 'log';

  const d = DEFAULT_SETTINGS;
  return {
    grid: {
      columns: getNum('grid', 'columns', d.grid.columns),
      padding: getNum('grid', 'padding', d.grid.padding),
    },
    panelTitle: {
      show:       getBool('panelTitle', 'show',     d.panelTitle.show),
      fontSize:   getNum ('panelTitle', 'fontSize', d.panelTitle.fontSize),
      bold:       getBool('panelTitle', 'bold',     d.panelTitle.bold),
      align:      getAlign(obj, 'panelTitle',        d.panelTitle.align),
      color:      getFillColor(obj, 'panelTitle', 'color',      d.panelTitle.color),
      background: getFillColor(obj, 'panelTitle', 'background', d.panelTitle.background),
    },
    labels: {
      show:         getBool('labels', 'show',      d.labels.show),
      showCount:    getBool('labels', 'showCount', d.labels.showCount),
      fontSize:     getNum ('labels', 'fontSize',  d.labels.fontSize),
      minHeight:    getNum ('labels', 'minHeight', d.labels.minHeight),
      minWidth:     getNum ('labels', 'minWidth',  d.labels.minWidth),
      bold:         getBool('labels', 'bold',      d.labels.bold),
      align:        getAlign(obj, 'labels',         d.labels.align),
      color:        getFillColor(obj, 'labels', 'color', d.labels.color),
      textOverflow: getTextOverflow(obj, 'labels',  d.labels.textOverflow),
    },
    itemLabels: {
      show:         getBool('itemLabels', 'show',      d.itemLabels.show),
      showCount:    getBool('itemLabels', 'showCount', d.itemLabels.showCount),
      fontSize:     getNum ('itemLabels', 'fontSize',  d.itemLabels.fontSize),
      minWidth:     getNum ('itemLabels', 'minWidth',  d.itemLabels.minWidth),
      bold:         getBool('itemLabels', 'bold',      d.itemLabels.bold),
      align:        getAlign(obj, 'itemLabels',         d.itemLabels.align),
      color:        getFillColor(obj, 'itemLabels', 'color', d.itemLabels.color),
      textOverflow: getTextOverflow(obj, 'itemLabels',  d.itemLabels.textOverflow),
    },
    legend: {
      show:          getBool('legend', 'show',          d.legend.show),
      position:      getLegendPos(obj,                   d.legend.position),
      fontSize:      getNum ('legend', 'fontSize',      d.legend.fontSize),
      bold:          getBool('legend', 'bold',          d.legend.bold),
      color:         getFillColor(obj, 'legend', 'color', d.legend.color),
      showTitle:     getBool('legend', 'showTitle',     d.legend.showTitle),
      titleFontSize: getNum ('legend', 'titleFontSize', d.legend.titleFontSize),
      titleBold:     getBool('legend', 'titleBold',     d.legend.titleBold),
      titleColor:    getFillColor(obj, 'legend', 'titleColor', d.legend.titleColor),
    },
    values: { scale },
    detailPopup: {
      enabled: getBool('detailPopup', 'enabled', d.detailPopup.enabled),
    },
    tooltipBehavior: {
      persistent: getBool('tooltipBehavior', 'persistent', d.tooltipBehavior.persistent),
      maxHeight:  getNum ('tooltipBehavior', 'maxHeight',  d.tooltipBehavior.maxHeight),
    },
    panelBorder: {
      show:  getBool('panelBorder', 'show',  d.panelBorder.show),
      width: getNum ('panelBorder', 'width', d.panelBorder.width),
      color: getFillColor(obj, 'panelBorder', 'color', d.panelBorder.color),
    },
    colorMapping: colorMap,
  };
}

export function enumerateInstances(
  options:  powerbi.EnumerateVisualObjectInstancesOptions,
  dataView: powerbi.DataView | undefined,
  host:     powerbi.extensibility.visual.IVisualHost,
  settings: VisualSettings
): powerbi.VisualObjectInstance[] {

  const slotMatch = options.objectName.match(/^colorSlot(\d+)$/);
  if (slotMatch) {
    const idx  = parseInt(slotMatch[1], 10);
    const keys = getUniqueColorKeys(dataView).filter(k => slotIndex(k) === idx);
    if (keys.length === 0) return [];
    const key   = keys[0];
    const color = settings.colorMapping.get(key) ?? host.colorPalette.getColor(key).value;
    return [{ objectName: options.objectName, displayName: key, selector: null,
              properties: { fill: { solid: { color } } } }];
  }

  const s = settings;
  switch (options.objectName) {
    case 'grid':
      return [{ objectName: 'grid', selector: null, properties: {
        columns: s.grid.columns, padding: s.grid.padding,
      }}];
    case 'panelTitle':
      return [{ objectName: 'panelTitle', selector: null, properties: {
        show: s.panelTitle.show, fontSize: s.panelTitle.fontSize,
        bold: s.panelTitle.bold, align: s.panelTitle.align,
        color:      { solid: { color: s.panelTitle.color } },
        background: { solid: { color: s.panelTitle.background || '#000000' } },
      }}];
    case 'labels':
      return [{ objectName: 'labels', selector: null, properties: {
        show: s.labels.show, showCount: s.labels.showCount,
        fontSize: s.labels.fontSize, minHeight: s.labels.minHeight, minWidth: s.labels.minWidth,
        bold: s.labels.bold, align: s.labels.align,
        color: { solid: { color: s.labels.color } },
        textOverflow: s.labels.textOverflow,
      }}];
    case 'itemLabels':
      return [{ objectName: 'itemLabels', selector: null, properties: {
        show: s.itemLabels.show, showCount: s.itemLabels.showCount,
        fontSize: s.itemLabels.fontSize, minWidth: s.itemLabels.minWidth,
        bold: s.itemLabels.bold, align: s.itemLabels.align,
        color: { solid: { color: s.itemLabels.color } },
        textOverflow: s.itemLabels.textOverflow,
      }}];
    case 'legend':
      return [{ objectName: 'legend', selector: null, properties: {
        show: s.legend.show, position: s.legend.position,
        fontSize: s.legend.fontSize, bold: s.legend.bold,
        color: { solid: { color: s.legend.color } },
        showTitle: s.legend.showTitle,
        titleFontSize: s.legend.titleFontSize, titleBold: s.legend.titleBold,
        titleColor: { solid: { color: s.legend.titleColor } },
      }}];
    case 'values':
      return [{ objectName: 'values', selector: null, properties: { scale: s.values.scale }}];
    case 'detailPopup':
      return [{ objectName: 'detailPopup', selector: null, properties: {
        enabled: s.detailPopup.enabled,
      }}];
    case 'tooltipBehavior':
      return [{ objectName: 'tooltipBehavior', selector: null, properties: {
        persistent: s.tooltipBehavior.persistent,
        maxHeight:  s.tooltipBehavior.maxHeight,
      }}];
    case 'panelBorder':
      return [{ objectName: 'panelBorder', selector: null, properties: {
        show:  s.panelBorder.show,
        width: s.panelBorder.width,
        color: { solid: { color: s.panelBorder.color } },
      }}];
    default:
      return [];
  }
}

export { slotIndex };
