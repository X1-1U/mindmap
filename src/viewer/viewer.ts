// 分享用 HTML 的唯讀檢視器：資料放在 <script id="mindmap-data"> 裡
import '../style.css';
import { MindMapEditor } from '../editor';
import { DATA_SCRIPT_ID, fileBaseName } from '../formats';
import { parseDocJSON, serialize } from '../model';
import { h } from '../ui';

const app = document.getElementById('app')!;
const raw = document.getElementById(DATA_SCRIPT_ID)?.textContent;

if (!raw) {
  app.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, '這個檔案沒有導圖資料')));
} else {
  const doc = parseDocJSON(raw);
  document.title = doc.root.text;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([serialize(doc, true)], { type: 'application/json' }));
    a.download = fileBaseName(doc) + '.mindmap';
    a.click();
  };
  const host = h('div');
  const zoomLabel = h('button', { class: 'zoom-label', onclick: () => editor.zoom(1 / editor.view.s) }, '100%');
  app.replaceChildren(h('div', { class: 'editor-screen' },
    h('header', { class: 'topbar' },
      h('div', { class: 'title' }, doc.root.text),
      h('button', { class: 'btn', onclick: download, title: '用思維導圖 App 打開後可以編輯' }, '下載原始檔')),
    h('div', { class: 'banner' }, h('span', {}, '🔒 唯讀・用思維導圖 App 的「開啟檔案」打開這個檔案，就能轉換成可編輯')),
    h('div', { class: 'canvas-wrap' }, host,
      h('div', { class: 'toolbar' },
        h('button', { onclick: () => editor.zoom(1 / 1.2) }, '−'), zoomLabel,
        h('button', { onclick: () => editor.zoom(1.2) }, '＋'),
        h('button', { onclick: () => editor.fit() }, '置中')))));
  const editor = new MindMapEditor(host, doc, { readonly: true, onView: s => { zoomLabel.textContent = Math.round(s * 100) + '%'; } });
}
