import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, writeFile, readDir, mkdir, remove, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener';
import type { MindMapDoc } from './types';
import { countNodes, parseDocJSON, serialize } from './model';

export const isTauri = '__TAURI_INTERNALS__' in window;

export interface StoredMeta { id: string; title: string; updated: number; count: number }

const metaOf = (id: string, doc: MindMapDoc): StoredMeta =>
  ({ id, title: doc.root.text, updated: doc.updatedAt || 0, count: countNodes(doc.root) });

/* ---------- 本機導圖庫 ---------- */

interface Storage {
  list(): Promise<StoredMeta[]>;
  load(id: string): Promise<MindMapDoc>;
  save(id: string, doc: MindMapDoc): Promise<void>;
  remove(id: string): Promise<void>;
}

/** App 版：每張導圖是 App 資料夾裡的一個 .mindmap 檔 */
const fileStorage: Storage = (() => {
  const DIR = 'maps', opt = { baseDir: BaseDirectory.AppData };
  const path = (id: string) => `${DIR}/${id}.mindmap`;
  let ready: Promise<void> | null = null;
  const ensure = () => (ready ||= (async () => { if (!(await exists(DIR, opt))) await mkdir(DIR, { ...opt, recursive: true }); })());
  return {
    async list() {
      await ensure();
      const out: StoredMeta[] = [];
      for (const e of await readDir(DIR, opt)) {
        if (!e.isFile || !e.name.endsWith('.mindmap')) continue;
        try { out.push(metaOf(e.name.slice(0, -8), parseDocJSON(await readTextFile(`${DIR}/${e.name}`, opt)))); }
        catch { /* 跳過損壞的檔案 */ }
      }
      return out.sort((a, b) => b.updated - a.updated);
    },
    async load(id) { await ensure(); return parseDocJSON(await readTextFile(path(id), opt)); },
    async save(id, doc) { await ensure(); await writeTextFile(path(id), serialize(doc), opt); },
    async remove(id) { await ensure(); await remove(path(id), opt); },
  };
})();

/** 網頁版：存在瀏覽器裡 */
const webStorage: Storage = (() => {
  const key = (id: string) => 'mindmap-doc-' + id;
  const ids = (): string[] => { try { return JSON.parse(localStorage.getItem('mindmap-ids') || '[]'); } catch { return []; } };
  const setIds = (v: string[]) => localStorage.setItem('mindmap-ids', JSON.stringify(v));
  return {
    async list() {
      const out: StoredMeta[] = [];
      for (const id of ids()) {
        try { out.push(metaOf(id, parseDocJSON(localStorage.getItem(key(id))!))); } catch { /* 跳過 */ }
      }
      return out.sort((a, b) => b.updated - a.updated);
    },
    async load(id) { return parseDocJSON(localStorage.getItem(key(id)) || ''); },
    async save(id, doc) {
      localStorage.setItem(key(id), serialize(doc));
      if (!ids().includes(id)) setIds([...ids(), id]);
    },
    async remove(id) { localStorage.removeItem(key(id)); setIds(ids().filter(x => x !== id)); },
  };
})();

export const storage: Storage = isTauri ? fileStorage : webStorage;

/* ---------- 開檔、存檔、外部連結 ---------- */

/** 讓使用者選一個檔案，回傳檔名與文字內容；取消時回傳 null */
export async function pickFile(extensions: string[]): Promise<{ name: string; text: string } | null> {
  if (isTauri) {
    const path = await openDialog({ multiple: false, directory: false, filters: [{ name: '思維導圖與大綱', extensions }] });
    if (!path) return null;
    return { name: path.replace(/^.*[\\/]/, ''), text: await readTextFile(path) };
  }
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: extensions.map(e => '.' + e).join(',') });
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const MIME: Record<string, string> = {
  png: 'image/png', html: 'text/html', md: 'text/markdown', opml: 'text/x-opml', mindmap: 'application/json',
};

/** 存檔；回傳 false 代表使用者取消 */
export async function saveFile(name: string, data: string | Uint8Array, ext: string, label: string): Promise<boolean> {
  if (isTauri) {
    const path = await saveDialog({ defaultPath: name, filters: [{ name: label, extensions: [ext] }] });
    if (!path) return false;
    if (typeof data === 'string') await writeTextFile(path, data); else await writeFile(path, data);
    return true;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] || 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

export function openUrl(url: string) {
  if (isTauri) tauriOpenUrl(url);
  else window.open(url, '_blank', 'noopener');
}
