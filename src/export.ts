import type { MindMapEditor, NodeView } from './editor';
import type { MindMapDoc } from './types';
import { DATA_SCRIPT_ID } from './formats';
import { serialize } from './model';

/** 依畫面上的版面把整張導圖畫成 PNG（2 倍解析度） */
export async function exportPNG(editor: MindMapEditor): Promise<Uint8Array> {
  const views = editor.layout();
  const pad = 40, scale = 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of views) {
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x + v.w);
    y0 = Math.min(y0, v.y - v.h / 2); y1 = Math.max(y1, v.y + v.h / 2);
  }
  const W = x1 - x0 + pad * 2, H = y1 - y0 + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(W * scale);
  canvas.height = Math.ceil(H * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(pad - x0, pad - y0);

  const bodyStyle = getComputedStyle(document.body);
  ctx.fillStyle = bodyStyle.backgroundColor || '#fff';
  ctx.fillRect(x0 - pad, y0 - pad, W, H);

  const byId = new Map(views.map(v => [v.n.id, v]));
  ctx.lineCap = 'round';
  for (const v of views) {
    if (!v.p) continue;
    const p = byId.get(v.p.id)!;
    const xa = v.side > 0 ? p.x + p.w : p.x, ya = p.y;
    const xb = v.side > 0 ? v.x : v.x + v.w, yb = v.y;
    const mx = (xa + xb) / 2;
    ctx.strokeStyle = v.color;
    ctx.lineWidth = v.depth === 1 ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.bezierCurveTo(mx, ya, mx, yb, xb, yb);
    ctx.stroke();
  }
  for (const v of views) drawNode(ctx, v);

  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('無法產生圖片'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > maxW) {
        // 英文盡量在空白處斷行
        const sp = line.lastIndexOf(' ');
        if (/\w/.test(ch) && sp > 0) { lines.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
        else { lines.push(line); line = ch.trimStart(); }
      } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

function drawNode(ctx: CanvasRenderingContext2D, v: NodeView) {
  const cs = getComputedStyle(v.el);
  const bx = v.side < 0 ? v.x + v.nw : v.x, by = v.y - v.h / 2;
  const border = parseFloat(cs.borderTopWidth) || 0;
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  ctx.beginPath();
  ctx.roundRect(bx + border / 2, by + border / 2, v.bw - border, v.h - border, radius);
  ctx.fillStyle = cs.backgroundColor;
  ctx.fill();
  if (border) { ctx.lineWidth = border; ctx.strokeStyle = cs.borderTopColor; ctx.stroke(); }

  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight), lh = parseFloat(cs.lineHeight) || 20;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.fillStyle = cs.color;
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, v.n.text, v.bw - padL - padR - border * 2 + 1);
  const top = v.y - (lines.length * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, bx + border + padL, top + lh * (i + 0.5)));

  if (v.noteEl && v.n.note) {
    const ns = getComputedStyle(v.noteEl);
    const nx = v.side < 0 ? v.x : v.x + v.bw;
    ctx.strokeStyle = v.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nx, v.y);
    ctx.lineTo(nx + v.nw, v.y);
    ctx.stroke();
    ctx.font = `${ns.fontWeight} ${ns.fontSize} ${ns.fontFamily}`;
    ctx.fillStyle = ns.color;
    const nlh = parseFloat(ns.lineHeight) || 16, npad = parseFloat(ns.paddingLeft);
    const nl = wrap(ctx, v.n.note, v.nw - npad * 2 + 1);
    ctx.textBaseline = 'alphabetic';
    nl.forEach((l, i) => ctx.fillText(l, nx + npad, v.y - 6 - (nl.length - 1 - i) * nlh));
  }
}

/**
 * 產生可以直接用瀏覽器打開的分享檔：唯讀檢視器＋導圖資料打包成一個 HTML。
 * 檢視器模板在建置時產生（public/viewer.html）。
 */
export async function exportHTML(doc: MindMapDoc): Promise<string> {
  const tpl = await fetch('/viewer.html').then(r => {
    if (!r.ok) throw new Error('找不到分享檔模板');
    return r.text();
  });
  const data = serialize({ ...doc, updatedAt: undefined }).replace(/</g, '\\u003c');
  const title = doc.root.text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  return tpl
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    // 用函式當替換值，避免資料裡的 $& 之類字元被當成特殊語法
    .replace('</head>', () => `<script type="application/json" id="${DATA_SCRIPT_ID}">${data}</script></head>`);
}
