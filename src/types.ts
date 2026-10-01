export type FontKey = 'sans' | 'serif' | 'kai' | 'round' | 'mono';

/** 主題框的自訂樣式；沒設定的項目用預設值 */
export interface NodeStyle {
  /** 框的寬、高（拖曳拉伸後的值），沒設定就依文字自動調整 */
  w?: number;
  h?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  font?: FontKey;
  size?: number;
  bold?: boolean;
  /** 文字、填充、框線顏色 */
  color?: string;
  fill?: string;
  border?: string;
}

export interface MapNode {
  id: string;
  text: string;
  /** 主題右側底線上的備註 */
  note?: string;
  /** 只用在中心主題的直接子主題：放在左邊或右邊 */
  side?: 'L' | 'R';
  collapsed?: boolean;
  style?: NodeStyle;
  children: MapNode[];
}

/** 標註名詞的維基百科解釋（存進檔案，離線也看得到） */
export interface TermInfo {
  title?: string;
  extract?: string;
  url?: string;
  thumb?: string;
}

/** .mindmap 檔案內容 */
export interface MindMapDoc {
  format: 'mindmap';
  version: 1;
  root: MapNode;
  terms: Record<string, TermInfo>;
  updatedAt?: number;
}
