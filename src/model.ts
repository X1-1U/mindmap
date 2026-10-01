import type { MapNode, MindMapDoc } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newNode(text: string, side?: 'L' | 'R'): MapNode {
  const n: MapNode = { id: uid(), text, children: [] };
  if (side) n.side = side;
  return n;
}

export function newDoc(title = '中心主題'): MindMapDoc {
  return { format: 'mindmap', version: 1, root: newNode(title), terms: {} };
}

export function sampleDoc(): MindMapDoc {
  const doc = newDoc('中心主題');
  const r = doc.root;
  r.children = [newNode('想法 1', 'R'), newNode('想法 2', 'R'), newNode('想法 3', 'L'), newNode('想法 4', 'L')];
  r.children[0].children = [newNode('細節 A'), newNode('細節 B')];
  r.children[1].note = '5 萬，含設備';
  r.children[2].note = '下週確認';
  return doc;
}

export function countNodes(n: MapNode): number {
  return 1 + n.children.reduce((a, c) => a + countNodes(c), 0);
}

export function serialize(doc: MindMapDoc, pretty = false): string {
  return JSON.stringify(doc, null, pretty ? 2 : 0);
}

function isNode(n: any): n is MapNode {
  return n && typeof n.text === 'string' && Array.isArray(n.children) && n.children.every(isNode);
}

function withIds(n: MapNode): MapNode {
  n.id ||= uid();
  n.children.forEach(withIds);
  return n;
}

/** 把匯入的根節點整理成合法的導圖：補 id，並把中心主題的子主題左右平衡 */
export function normalizeRoot(root: MapNode): MapNode {
  withIds(root);
  const kids = root.children;
  const right = Math.ceil(kids.length / 2);
  kids.forEach((c, i) => { if (c.side !== 'L' && c.side !== 'R') c.side = i < right ? 'R' : 'L'; });
  (function strip(n: MapNode, depth: number) {
    if (depth > 1) delete n.side;
    n.children.forEach(c => strip(c, depth + 1));
  })(root, 0);
  return root;
}

/** 解析 .mindmap / .json。也接受早期原型匯出的格式（根節點直接在最外層） */
export function parseDocJSON(text: string): MindMapDoc {
  const data = JSON.parse(text);
  if (data?.format === 'mindmap' && isNode(data.root)) {
    return { format: 'mindmap', version: 1, root: normalizeRoot(data.root), terms: data.terms ?? {}, updatedAt: data.updatedAt };
  }
  if (isNode(data)) {
    const terms = (data as any).terms ?? {};
    delete (data as any).terms;
    return { format: 'mindmap', version: 1, root: normalizeRoot(data), terms };
  }
  throw new Error('檔案內容不是思維導圖格式');
}
