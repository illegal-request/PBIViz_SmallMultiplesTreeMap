import { ColorManager } from '../src/colorManager';

const mockPalette: powerbi.extensibility.IColorPalette = {
  getColor: (key: string) => ({ value: `#palette-${key}` }),
} as any;

describe('ColorManager', () => {
  it('returns the format pane override when set', () => {
    const cm = new ColorManager(mockPalette, new Map([['Active', '#ff0000']]));
    expect(cm.getColor('Active')).toBe('#ff0000');
  });

  it('falls back to theme palette when no override', () => {
    const cm = new ColorManager(mockPalette, new Map());
    expect(cm.getColor('Active')).toBe('#palette-Active');
  });

  it('returns same color for same key across calls', () => {
    const cm = new ColorManager(mockPalette, new Map());
    expect(cm.getColor('Pending')).toBe(cm.getColor('Pending'));
  });

  it('collectKeys returns all unique colorKey values across panels/groups/items', () => {
    const cm = new ColorManager(mockPalette, new Map());
    const panels = [
      {
        title: 'DivA - 3 units',
        groups: [
          { title: 'G1', total: 3, items: [
            { label: 'E1', displayLabel: 'E1', value: 1, colorKey: 'Active',  rowIndices: [0] },
            { label: 'E2', displayLabel: 'E2', value: 2, colorKey: 'Pending', rowIndices: [1] },
          ]},
        ],
      },
      {
        title: 'DivB - 3 units',
        groups: [
          { title: 'G2', total: 3, items: [
            { label: 'E3', displayLabel: 'E3', value: 3, colorKey: 'Active', rowIndices: [2] },
          ]},
        ],
      },
    ];
    expect(cm.collectKeys(panels).sort()).toEqual(['Active', 'Pending']);
  });
});
