export interface MapNode {
  id: string;
  text: string;
  /** 主題右側底線上的備註 */
  note?: string;
  /** 只用在中心主題的直接子主題：放在左邊或右邊 */
  side?: 'L' | 'R';
  collapsed?: boolean;
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
