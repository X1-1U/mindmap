import type { MapNode, MindMapDoc } from './types';
import { newNode, normalizeRoot, parseDocJSON } from './model';

export const IMPORT_EXTENSIONS = ['mindmap', 'json', 'md', 'markdown', 'txt', 'opml', 'html', 'htm'];
export const DATA_SCRIPT_ID = 'mindmap-data';

const ext = (name: string) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
const baseName = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || '匯入的導圖';

export interface ImportResult {
  doc: MindMapDoc;
  /** 給使用者看的來源說明，例如「Markdown 大綱」 */
  source: string;
  /** 是否完整保留（.mindmap / 自家 HTML），否則是從其他格式轉換而來 */
  lossless: boolean;
}

/** 依副檔名與內容自動判斷格式並轉成導圖 */
export function importFile(name: string, text: string): ImportResult {
  const e = ext(name);
  if (e === 'mindmap' || e === 'json') return { doc: parseDocJSON(text), source: e === 'json' ? 'JSON' : '思維導圖檔', lossless: true };
  if (e === 'html' || e === 'htm') return { doc: parseExportedHTML(text), source: '思維導圖分享檔（HTML）', lossless: true };
  if (e === 'opml' || /^\s*<\?xml[\s\S]*<opml/i.test(text)) return { doc: wrap(parseOPML(text, baseName(name))), source: 'OPML 大綱', lossless: false };
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    try { return { doc: parseDocJSON(text), source: 'JSON', lossless: true }; } catch { /* 當成純文字 */ }
  }
  return { doc: wrap(parseOutline(text, baseName(name))), source: e === 'txt' ? '純文字大綱' : 'Markdown 大綱', lossless: false };
}

const wrap = (root: MapNode): MindMapDoc => ({ format: 'mindmap', version: 1, root: normalizeRoot(root), terms: {} });

function parseExportedHTML(html: string): MindMapDoc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const data = doc.getElementById(DATA_SCRIPT_ID)?.textContent;
  if (!data) throw new Error('這個 HTML 不是由思維導圖匯出的，沒有可以匯入的資料。');
  return parseDocJSON(data);
}

function cleanInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim();
}

/**
 * 把 Markdown 標題、條列、或用縮排表示層級的純文字轉成樹。
 * 標題層級優先，條列依縮排深度掛在最近的標題底下。
 */
export function parseOutline(text: string, fallbackTitle: string): MapNode {
  const top: MapNode = newNode(fallbackTitle);
  const stack: { key: number; node: MapNode }[] = [{ key: -1, node: top }];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim() || /^\s*(```|---+\s*$|\*\*\*+\s*$)/.test(raw)) continue;
    let key: number, body: string;
    const h = raw.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      key = h[1].length;
      body = h[2].replace(/\s+#+\s*$/, '');
    } else {
      const indent = raw.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length;
      key = 10 + indent;
      body = raw.trim().replace(/^([-*+•·]|\d+[.)、])\s+/, '');
    }
    body = cleanInline(body);
    if (!body) continue;
    while (stack.length > 1 && stack[stack.length - 1].key >= key) stack.pop();
    const n = newNode(body);
    stack[stack.length - 1].node.children.push(n);
    stack.push({ key, node: n });
  }
  // 只有一個最上層項目時，它就是中心主題
  return top.children.length === 1 ? top.children[0] : top;
}

function parseOPML(xml: string, fallbackTitle: string): MapNode {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('OPML 檔案格式錯誤');
  const conv = (el: Element): MapNode => {
    const n = newNode(el.getAttribute('text') || el.getAttribute('title') || '（無標題）');
    const note = el.getAttribute('_note');
    if (note) n.note = note;
    n.children = [...el.children].filter(c => c.tagName === 'outline').map(conv);
    return n;
  };
  const outlines = [...(doc.querySelector('body')?.children || [])].filter(c => c.tagName === 'outline').map(conv);
  if (outlines.length === 1) return outlines[0];
  const root = newNode(doc.querySelector('head > title')?.textContent?.trim() || fallbackTitle);
  root.children = outlines;
  return root;
}

/* ---------- 匯出 ---------- */

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ');

export function toMarkdown(doc: MindMapDoc): string {
  const lines = ['# ' + oneLine(doc.root.text), ''];
  (function walk(n: MapNode, d: number) {
    for (const c of n.children) {
      lines.push('  '.repeat(d) + '- ' + oneLine(c.text) + (c.note ? '：' + oneLine(c.note) : ''));
      walk(c, d + 1);
    }
  })(doc.root, 0);
  return lines.join('\n') + '\n';
}

export function toOPML(doc: MindMapDoc): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)).replace(/\n/g, '&#10;');
  const out = (n: MapNode, pad: string): string => {
    const attrs = `text="${esc(n.text)}"` + (n.note ? ` _note="${esc(n.note)}"` : '');
    return n.children.length
      ? `${pad}<outline ${attrs}>\n${n.children.map(c => out(c, pad + '  ')).join('\n')}\n${pad}</outline>`
      : `${pad}<outline ${attrs}/>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${esc(doc.root.text)}</title></head>\n  <body>\n${out(doc.root, '    ')}\n  </body>\n</opml>\n`;
}

export function fileBaseName(doc: MindMapDoc): string {
  return oneLine(doc.root.text).replace(/[\\/:*?"<>|]/g, '').slice(0, 40).trim() || 'mindmap';
}
