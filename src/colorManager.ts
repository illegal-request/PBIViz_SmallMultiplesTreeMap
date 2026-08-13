import { Panel } from './types';

export class ColorManager {
  private palette: powerbi.extensibility.IColorPalette;
  private overrides: Map<string, string>;
  private cache: Map<string, string> = new Map();

  constructor(
    palette: powerbi.extensibility.IColorPalette,
    overrides: Map<string, string>
  ) {
    this.palette = palette;
    this.overrides = overrides;
  }

  getColor(colorKey: string): string {
    if (this.overrides.has(colorKey)) return this.overrides.get(colorKey)!;
    if (this.cache.has(colorKey))    return this.cache.get(colorKey)!;
    const color = this.palette.getColor(colorKey).value;
    this.cache.set(colorKey, color);
    return color;
  }

  collectKeys(panels: Panel[]): string[] {
    const keys = new Set<string>();
    panels.forEach(p =>
      p.groups.forEach(g =>
        g.items.forEach(e => keys.add(e.colorKey))
      )
    );
    return Array.from(keys);
  }
}
