import { transformDataView } from '../src/dataTransform';
import { Panel } from '../src/types';

function makeDataView(
  columns: powerbi.DataViewMetadataColumn[],
  rows: powerbi.DataViewTableRow[]
): powerbi.DataView {
  return {
    table: {
      columns,
      rows,
      identity: rows.map((_, i) => ({ key: String(i) }) as any),
    },
    metadata: { columns },
  } as powerbi.DataView;
}

const COLS: powerbi.DataViewMetadataColumn[] = [
  { displayName: 'Region',    roles: { panelBy: true },  index: 0, type: { text: true }    as any },
  { displayName: 'Group',     roles: { groupBy: true },  index: 1, type: { text: true }    as any },
  { displayName: 'Item',      roles: { label: true },    index: 2, type: { text: true }    as any },
  { displayName: 'Units',     roles: { measure: true },  index: 3, type: { numeric: true } as any },
  { displayName: 'Status',    roles: { colorBy: true },  index: 4, type: { text: true }    as any },
];

describe('transformDataView', () => {
  it('returns empty array when dataView is undefined', () => {
    expect(transformDataView(undefined)).toEqual([]);
  });

  it('returns empty array when table is missing', () => {
    expect(transformDataView({} as powerbi.DataView)).toEqual([]);
  });

  it('returns empty array when measure column is missing', () => {
    const cols = COLS.filter(c => !c.roles?.measure);
    expect(transformDataView(makeDataView(cols, [['D', 'G', 'E', 'S']]))).toEqual([]);
  });

  it('creates one panel per unique panelBy value', () => {
    const rows: powerbi.DataViewTableRow[] = [
      ['DivA', 'G1', 'E1', 10, 'Active'],
      ['DivA', 'G1', 'E2', 5,  'Pending'],
      ['DivB', 'G2', 'E3', 8,  'Active'],
    ];
    const panels = transformDataView(makeDataView(COLS, rows));
    expect(panels).toHaveLength(2);
    expect(panels[0].title).toMatch(/^DivA/);
    expect(panels[1].title).toMatch(/^DivB/);
  });

  it('creates groups within each panel', () => {
    const rows: powerbi.DataViewTableRow[] = [
      ['DivA', 'G1', 'E1', 10, 'Active'],
      ['DivA', 'G2', 'E2', 5,  'Pending'],
      ['DivA', 'G1', 'E3', 3,  'Active'],
    ];
    const panels = transformDataView(makeDataView(COLS, rows));
    expect(panels[0].groups).toHaveLength(2);
    expect(panels[0].groups[0].title).toBe('G1');
    expect(panels[0].groups[0].items).toHaveLength(2);
    expect(panels[0].groups[1].title).toBe('G2');
    expect(panels[0].groups[1].items).toHaveLength(1);
  });

  it('builds panel title with total measure value', () => {
    const rows: powerbi.DataViewTableRow[] = [
      ['DivA', 'G1', 'E1', 10, 'Active'],
      ['DivA', 'G1', 'E2', 5,  'Pending'],
    ];
    const panels = transformDataView(makeDataView(COLS, rows));
    expect(panels[0].title).toBe('DivA - 15 Units');
  });

  it('builds item fields correctly', () => {
    const rows: powerbi.DataViewTableRow[] = [
      ['DivA', 'G1', 'Item Alpha', 10, 'Active'],
    ];
    const panels = transformDataView(makeDataView(COLS, rows));
    const item = panels[0].groups[0].items[0];
    expect(item.label).toBe('Item Alpha');
    expect(item.value).toBe(10);
    expect(item.colorKey).toBe('Active');
    expect(item.rowIndices).toEqual([0]);
  });

  it('aggregates items with the same label within a group', () => {
    const rows: powerbi.DataViewTableRow[] = [
      ['DivA', 'G1', 'E1', 10, 'Active'],
      ['DivA', 'G1', 'E1', 5,  'Active'],
    ];
    const panels = transformDataView(makeDataView(COLS, rows));
    const item = panels[0].groups[0].items[0];
    expect(item.value).toBe(15);
    expect(item.rowIndices).toEqual([0, 1]);
  });

  it('falls back gracefully when panelBy or groupBy is absent', () => {
    const cols: powerbi.DataViewMetadataColumn[] = [
      { displayName: 'Item',     roles: { label: true },   index: 0, type: { text: true }    as any },
      { displayName: 'Units',    roles: { measure: true }, index: 1, type: { numeric: true } as any },
      { displayName: 'Status',   roles: { colorBy: true }, index: 2, type: { text: true }    as any },
    ];
    const rows: powerbi.DataViewTableRow[] = [['E1', 10, 'Active']];
    const panels = transformDataView(makeDataView(cols, rows));
    expect(panels).toHaveLength(1);
    expect(panels[0].groups).toHaveLength(1);
    expect(panels[0].groups[0].items).toHaveLength(1);
  });
});
