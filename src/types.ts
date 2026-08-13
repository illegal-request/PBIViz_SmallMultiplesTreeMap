export interface Item {
  label: string;        // Item Name — used for cross-filtering identity
  displayLabel: string; // Block Display Name if provided, otherwise same as label
  value: number;
  colorKey: string;
  rowIndices: number[];
}

export interface Group {
  title: string;
  total: number;
  items: Item[];
}

export interface Panel {
  title: string;
  groups: Group[];
}

export type Alignment    = 'left' | 'center' | 'right';
export type LegendPosition = 'top' | 'bottom' | 'left' | 'right';
export type TextOverflow = 'clip' | 'ellipsis' | 'wrap' | 'resize';

export interface VisualSettings {
  grid: {
    columns: number;
    padding: number;
  };
  panelTitle: {
    show: boolean;
    fontSize: number;
    bold: boolean;
    align: Alignment;
    color: string;
    background: string;
  };
  labels: {
    show: boolean;
    showCount: boolean;
    fontSize: number;
    minHeight: number;
    minWidth: number;
    bold: boolean;
    align: Alignment;
    color: string;
    textOverflow: TextOverflow;
  };
  itemLabels: {
    show: boolean;
    showCount: boolean;
    fontSize: number;
    minWidth: number;
    bold: boolean;
    align: Alignment;
    color: string;
    textOverflow: TextOverflow;
  };
  legend: {
    show: boolean;
    position: LegendPosition;
    fontSize: number;
    bold: boolean;
    color: string;
    showTitle: boolean;
    titleFontSize: number;
    titleBold: boolean;
    titleColor: string;
  };
  values: {
    scale: 'linear' | 'sqrt' | 'log';
  };
  tooltipBehavior: {
    persistent: boolean;
    maxHeight:  number;
  };
  detailPopup: {
    enabled: boolean;
  };
  panelBorder: {
    show: boolean;
    width: number;
    color: string;
  };
  colorMapping: Map<string, string>;
}

export const DEFAULT_SETTINGS: VisualSettings = {
  grid:        { columns: 0, padding: 8 },
  panelTitle:  { show: true,  fontSize: 13, bold: true,  align: 'left', color: '#ffffff', background: '' },
  labels:      { show: true,  showCount: false, fontSize: 11, minHeight: 0, minWidth: 30,
                 bold: false, align: 'left', color: '#ffffff', textOverflow: 'ellipsis' },
  itemLabels:  { show: false, showCount: false, fontSize: 9,  minWidth: 20,
                 bold: false, align: 'left', color: '#ffffff', textOverflow: 'ellipsis' },
  legend:      { show: false, position: 'bottom', fontSize: 11, bold: false, color: '#333333',
                 showTitle: true, titleFontSize: 11, titleBold: true, titleColor: '#333333' },
  values:         { scale: 'sqrt' },
  tooltipBehavior:{ persistent: false, maxHeight: 400 },
  detailPopup:    { enabled: true },
  panelBorder:    { show: false, width: 2, color: '#aaaaaa' },
  colorMapping: new Map(),
};
