import { Panel, Group, Item } from './types';

export function getMeasureName(dataView: powerbi.DataView | undefined): string {
  if (!dataView?.table) return 'Value';
  const col = dataView.table.columns.find(c => c.roles?.['measure']);
  return col?.displayName ?? 'Value';
}

export function transformDataView(dataView: powerbi.DataView | undefined): Panel[] {
  if (!dataView?.table) return [];

  const { columns, rows } = dataView.table;

  let panelByIndex      = -1;
  let groupByIndex      = -1;
  let labelIndex        = -1;
  let measureIndex      = -1;
  let colorByIndex      = -1;
  let labelOverrideIndex = -1;

  columns.forEach((col, i) => {
    if (col.roles?.['panelBy'])       panelByIndex       = i;
    if (col.roles?.['groupBy'])       groupByIndex       = i;
    if (col.roles?.['label'])         labelIndex         = i;
    if (col.roles?.['measure'])       measureIndex       = i;
    if (col.roles?.['colorBy'])       colorByIndex       = i;
    if (col.roles?.['labelOverride']) labelOverrideIndex = i;
  });

  if (measureIndex === -1) return [];

  // panelMap: panelKey → groupMap: groupKey → Item[]
  const panelMap = new Map<string, Map<string, Item[]>>();
  const panelTotals = new Map<string, number>();

  rows.forEach((row, rowIndex) => {
    const panelKey    = panelByIndex      >= 0 ? String(row[panelByIndex]      ?? '') : '';
    const groupKey    = groupByIndex      >= 0 ? String(row[groupByIndex]      ?? '') : '';
    const label       = labelIndex        >= 0 ? String(row[labelIndex]        ?? '') : '';
    const rawOverride = labelOverrideIndex >= 0 ? String(row[labelOverrideIndex] ?? '') : '';
    const displayLabel = rawOverride !== '' ? rawOverride : label;
    const value       = Number(row[measureIndex] ?? 0);
    const rawColorKey = colorByIndex >= 0 ? String(row[colorByIndex] ?? '') : '';
    const colorKey    = rawColorKey !== '' ? rawColorKey : '(Blank)';

    if (!panelMap.has(panelKey)) {
      panelMap.set(panelKey, new Map());
      panelTotals.set(panelKey, 0);
    }
    panelTotals.set(panelKey, (panelTotals.get(panelKey) ?? 0) + value);

    const groupMap = panelMap.get(panelKey)!;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);

    const items = groupMap.get(groupKey)!;
    // Deduplicate by (label + colorKey) so each unique status gets its own colored block
    const existing = items.find(e => e.label === label && e.colorKey === colorKey);
    if (existing) {
      existing.value += value;
      existing.rowIndices.push(rowIndex);
      // Keep the first non-empty displayLabel seen for this item
      if (existing.displayLabel === existing.label && displayLabel !== label) {
        existing.displayLabel = displayLabel;
      }
    } else {
      items.push({ label, displayLabel, value, colorKey, rowIndices: [rowIndex] });
    }
  });

  const measureName = getMeasureName(dataView);

  return Array.from(panelMap.entries()).map(([panelKey, groupMap]) => {
    const total = panelTotals.get(panelKey) ?? 0;
    const title = panelKey ? `${panelKey} - ${total} ${measureName}` : `${total} ${measureName}`;

    const groups: Group[] = Array.from(groupMap.entries()).map(([groupKey, items]) => ({
      title: groupKey,
      total: items.reduce((s, e) => s + e.value, 0),
      items,
    }));

    const panel: Panel = { title, groups };
    return panel;
  });
}
