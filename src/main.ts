import './style.css';
import type { MindMapDoc } from './types';
import { MindMapEditor } from './editor';
import { countNodes, newDoc, serialize, uid } from './model';
import { IMPORT_EXTENSIONS, fileBaseName, importFile, toMarkdown, toOPML } from './formats';
import { exportHTML, exportPNG } from './export';
import { openUrl, pickFile, saveFile, storage, type StoredMeta } from './platform';
import { createStylePanel } from './stylepanel';
import { alertDialog, chooseOpenMode, confirmDialog, h, showMenu, toast } from './ui';

const app = document.getElementById('app')!;

// 未預期的錯誤直接顯示在畫面上（手機上看不到主控台）
function showFatal(msg: string) {
  console.error(msg);
  let box = document.querySelector<HTMLElement>('.fatal');
  if (!box) { box = h('pre', { class: 'fatal' }); document.body.append(box); }
  box.textContent += msg + '\n';
}
// iOS 鍵盤彈出時會把整個頁面往上推；改成讓 App 高度跟著鍵盤以上的可見區域
const vv = window.visualViewport;
if (vv) {
  const fitViewport = () => {
    // WKWebView 會自己捲動整個網頁，所以把 App 放回可見區域的位置
    document.documentElement.style.setProperty('--app-h', vv.height + 'px');
    document.documentElement.style.setProperty('--app-top', vv.offsetTop + 'px');
  };
  vv.addEventListener('resize', fitViewport);
  vv.addEventListener('scroll', fitViewport);
  fitViewport();
}

addEventListener('error', e => showFatal(`錯誤：${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', e => showFatal(`錯誤：${e.reason?.message || e.reason}`));
let editor: MindMapEditor | null = null;
/** 離開編輯畫面前要先把還沒寫入的修改存好 */
let flushSave: (() => Promise<void>) | null = null;

async function leaveEditor() {
  await flushSave?.();
  flushSave = null;
  editor?.destroy();
  editor = null;
}

function relTime(t: number): string {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  if (s < 172800) return '昨天';
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ---------- 首頁 ---------- */

async function showHome() {
  await leaveEditor();
  document.title = '思維導圖';
  let list: StoredMeta[] = [];
  try {
    // 讀取逾時也不要讓畫面一直空白
    list = await Promise.race([storage.list(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('讀取逾時')), 5000))]);
  } catch (e: any) { showFatal(`讀不到導圖：${e?.message || e}`); }

  const card = (m: StoredMeta) => h('div', { class: 'map-card', role: 'button', tabindex: '0', onclick: () => openStored(m.id),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') openStored(m.id); } },
    h('div', { class: 'map-thumb' }, h('span', {}, m.title)),
    h('div', { class: 'map-title' }, m.title),
    h('div', { class: 'map-meta' }, `${m.count} 個主題` + (m.updated ? ` · ${relTime(m.updated)}` : '')),
    h('button', { class: 'map-del', title: '刪除', 'aria-label': `刪除「${m.title}」`, onclick: async (e: Event) => {
      e.stopPropagation();
      if (!(await confirmDialog('刪除導圖？', `「${m.title}」會被永久刪除，無法復原。`, '刪除', true))) return;
      await storage.remove(m.id);
      showHome();
    } }, '×'));

  app.replaceChildren(h('div', { class: 'home' }, h('div', { class: 'home-inner' },
    h('div', { class: 'home-head' },
      h('h1', {}, '我的導圖'),
      h('button', { class: 'btn', onclick: openFromDisk, title: '開啟檔案 (⌘O)' }, '開啟檔案'),
      h('button', { class: 'btn primary', onclick: createMap, title: '新建導圖 (⌘N)' }, '新建導圖')),
    list.length
      ? h('div', { class: 'grid' }, ...list.map(card))
      : h('div', { class: 'empty' },
          h('h2', {}, '建立你的第一張導圖'),
          h('p', {}, '也可以打開別人傳來的導圖、Markdown 或 OPML 檔。'),
          h('button', { class: 'btn primary', onclick: createMap }, '新建導圖')),
  )));
}

async function createMap() {
  const doc = newDoc('中心主題');
  doc.updatedAt = Date.now();
  const id = uid();
  await storage.save(id, doc);
  await showEditor(doc, { id });
  editor?.edit();
}

async function openStored(id: string) {
  try { await showEditor(await storage.load(id), { id }); }
  catch (e: any) { alertDialog('打不開這張導圖', String(e?.message || e)); }
}

async function openFromDisk() {
  let picked;
  try { picked = await pickFile(IMPORT_EXTENSIONS); }
  catch (e: any) { return alertDialog('無法開啟檔案', String(e?.message || e)); }
  if (!picked) return;
  let result;
  try { result = importFile(picked.name, picked.text); }
  catch (e: any) { return alertDialog('無法開啟檔案', `「${picked.name}」：${e?.message || e}`); }
  const mode = await chooseOpenMode(picked.name, `${result.source}・${countNodes(result.doc.root)} 個主題`);
  if (mode === 'preview') await showEditor(result.doc, { readonly: true, fileName: picked.name });
  else if (mode === 'convert') await convertAndEdit(result.doc);
}

async function convertAndEdit(doc: MindMapDoc) {
  const copy: MindMapDoc = JSON.parse(serialize(doc));
  copy.updatedAt = Date.now();
  const id = uid();
  await storage.save(id, copy);
  await showEditor(copy, { id });
  toast('已轉換，存到「我的導圖」');
}

/* ---------- 編輯畫面 ---------- */

interface EditorContext { id?: string; readonly?: boolean; fileName?: string }

async function showEditor(doc: MindMapDoc, ctx: EditorContext) {
  await leaveEditor();
  const readonly = !!ctx.readonly;

  const title = h('div', { class: 'title' }, doc.root.text);
  const status = h('span', { class: 'status' }, readonly ? '' : '已儲存');
  const exportBtn = h('button', { class: 'btn', onclick: () => openExportMenu(exportBtn, doc) }, '分享／匯出');
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'btn ghost', onclick: showHome, title: '回到我的導圖' }, '‹ 我的導圖'),
    title, status, exportBtn);

  const banner = readonly
    ? h('div', { class: 'banner' },
        h('span', {}, `🔒 唯讀預覽・${ctx.fileName || ''}`),
        h('button', { class: 'btn', onclick: () => convertAndEdit(doc) }, '✎ 轉換並編輯'))
    : '';

  const host = h('div');
  const zoomLabel = h('button', { class: 'zoom-label', title: '重設為 100%', onclick: () => editor!.zoom(1 / editor!.view.s) }, '100%');
  const undoBtn = h('button', { class: 'wide', title: '復原 (⌘Z)', onclick: () => editor!.undo(), disabled: '' }, '復原') as HTMLButtonElement;
  const redoBtn = h('button', { class: 'wide', title: '重做 (⇧⌘Z)', onclick: () => editor!.redo(), disabled: '' }, '重做') as HTMLButtonElement;
  const sep = (wide = false) => h('span', { class: 'sep' + (wide ? ' wide' : '') });
  const stylePanel = createStylePanel(() => editor);
  const toolbar = h('div', { class: 'toolbar' },
    ...(readonly ? [] : [
      h('button', { class: 'wide', title: '新增子主題 (Tab)', onclick: () => editor!.addChild() }, '＋子主題'),
      h('button', { class: 'wide', title: '刪除 (Delete)', onclick: () => editor!.removeSelected() }, '刪除'),
      h('button', { class: 'wide', title: '主題樣式：對齊、字體、顏色、大小', onclick: () => stylePanel.toggle() }, '樣式'),
      sep(true), undoBtn, redoBtn, sep(true),
    ]),
    h('button', { title: '縮小 (-)', onclick: () => editor!.zoom(1 / 1.2) }, '−'),
    zoomLabel,
    h('button', { title: '放大 (+)', onclick: () => editor!.zoom(1.2) }, '＋'),
    h('button', { title: '全部顯示 (0)', onclick: () => editor!.fit() }, '置中'));
  // 工具列按鈕不搶走焦點，避免中斷文字編輯
  toolbar.addEventListener('mousedown', e => e.preventDefault());

  const helpCollapsed = localStorage.getItem('mindmap-help') === 'collapsed';
  const help = h('div', { class: 'help' + (helpCollapsed ? ' collapsed' : '') },
    h('button', { class: 'help-head', onclick: () => {
      const c = help.classList.toggle('collapsed');
      try { localStorage.setItem('mindmap-help', c ? 'collapsed' : 'open'); } catch { /* 忽略 */ }
    } }, '快捷鍵'),
    h('div', { class: 'rows', html: readonly
      ? '<div><kbd>←↑↓→</kbd>切換選取</div><div><kbd>/</kbd>摺疊／展開</div><div>點藍色名詞看解釋</div><div>拖曳空白處平移，⌘／雙指縮放</div>'
      : `<div><kbd>Tab</kbd>新增子主題</div><div><kbd>Enter</kbd>新增同級主題</div><div><kbd>Space</kbd>或雙擊 編輯文字</div>
         <div><kbd>N</kbd>新增／編輯備註</div><div><kbd>Delete</kbd>刪除主題</div><div><kbd>/</kbd>摺疊／展開</div>
         <div><kbd>←↑↓→</kbd>切換選取</div><div><kbd>⌘Z</kbd>復原 <kbd>⇧⌘Z</kbd>重做</div>
         <div>貼上多行文字，自動變成子主題</div><div>編輯時選取文字，可以標註名詞</div>` }));

  const tab = (icon: string, label: string, fn: () => void) =>
    h('button', { onclick: fn }, h('b', {}, icon), label);
  const bottombar = readonly ? '' : h('nav', { class: 'bottombar' },
    tab('＋', '子主題', () => editor!.addChild()),
    tab('✎', '編輯', () => editor!.edit()),
    tab('≡', '備註', () => editor!.editNote()),
    tab('Aa', '樣式', () => stylePanel.toggle()),
    tab('×', '刪除', () => editor!.removeSelected()),
    tab('↶', '復原', () => editor!.undo()));

  app.replaceChildren(h('div', { class: 'editor-screen' },
    topbar, banner, h('div', { class: 'canvas-wrap' }, host, toolbar, help, readonly ? '' : stylePanel.el), bottombar));

  // 自動儲存：停止修改 0.6 秒後寫入
  let timer = 0, pending = false;
  const save = async () => {
    clearTimeout(timer);
    if (!pending || !ctx.id) return;
    pending = false;
    doc.updatedAt = Date.now();
    try { await storage.save(ctx.id, doc); status.textContent = '已儲存'; status.classList.remove('error'); }
    catch (e) { status.textContent = '儲存失敗'; status.classList.add('error'); console.error(e); }
  };
  flushSave = save;

  editor = new MindMapEditor(host, doc, {
    readonly,
    openUrl,
    onSelect: () => stylePanel.refresh(),
    onChange: () => {
      stylePanel.refresh();
      title.textContent = doc.root.text;
      document.title = doc.root.text;
      if (readonly) return;
      pending = true;
      status.textContent = '儲存中…';
      clearTimeout(timer);
      timer = window.setTimeout(save, 600);
    },
    onView: s => { zoomLabel.textContent = Math.round(s * 100) + '%'; },
    onHistory: (u, r) => { undoBtn.disabled = !u; redoBtn.disabled = !r; },
  });
  document.title = doc.root.text;
}

function openExportMenu(anchor: HTMLElement, doc: MindMapDoc) {
  const name = fileBaseName(doc);
  const run = async (fn: () => Promise<boolean>) => {
    try { if (await fn()) toast('已匯出'); }
    catch (e: any) { alertDialog('匯出失敗', String(e?.message || e)); }
  };
  showMenu(anchor, [
    { label: '分享檔（HTML）', hint: '任何瀏覽器都能打開，可縮放、看名詞解釋', action: () => run(async () => saveFile(`${name}.html`, await exportHTML(doc), 'html', 'HTML 分享檔')) },
    { label: '圖片（PNG）', hint: '傳到聊天軟體，一眼看懂', action: () => run(async () => saveFile(`${name}.png`, await exportPNG(editor!), 'png', 'PNG 圖片')) },
    { label: 'Markdown 大綱', hint: '貼到 Notion、Obsidian 等筆記軟體', action: () => run(() => saveFile(`${name}.md`, toMarkdown(doc), 'md', 'Markdown')) },
    { label: 'OPML 大綱', hint: '給 XMind、MindNode 等導圖軟體', action: () => run(() => saveFile(`${name}.opml`, toOPML(doc), 'opml', 'OPML')) },
    { label: '思維導圖檔（.mindmap）', hint: '完整備份，或給也有這個 App 的人', action: () => run(() => saveFile(`${name}.mindmap`, serialize({ ...doc, updatedAt: undefined }, true), 'mindmap', '思維導圖')) },
  ]);
}

/* ---------- 全域快捷鍵 ---------- */

document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || document.querySelector('.modal-backdrop')) return;
  const k = e.key.toLowerCase();
  if (k === 'o') { e.preventDefault(); openFromDisk(); }
  else if (k === 'n') { e.preventDefault(); createMap(); }
});

showHome();
