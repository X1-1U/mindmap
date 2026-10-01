export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...children: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

/** 顯示一個對話框；resolve 的值由按鈕或 close() 決定 */
function modal<T>(build: (close: (v: T) => void) => HTMLElement, cancelValue: T): Promise<T> {
  return new Promise(resolve => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (v: T) => { backdrop.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(cancelValue); } };
    backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) close(cancelValue); });
    document.addEventListener('keydown', onKey, true);
    backdrop.append(build(close));
    document.body.append(backdrop);
    backdrop.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  });
}

export function confirmDialog(title: string, message: string, ok = '確定', danger = false): Promise<boolean> {
  return modal(close => h('div', { class: 'modal', role: 'dialog' },
    h('h2', {}, title),
    h('p', { class: 'modal-msg' }, message),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => close(false) }, '取消'),
      h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), 'data-autofocus': '', onclick: () => close(true) }, ok)),
  ), false);
}

export function alertDialog(title: string, message: string): Promise<void> {
  return modal<void>(close => h('div', { class: 'modal', role: 'alertdialog' },
    h('h2', {}, title),
    h('p', { class: 'modal-msg' }, message),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', 'data-autofocus': '', onclick: () => close() }, '知道了')),
  ), undefined);
}

export type OpenMode = 'preview' | 'convert';
const MODE_KEY = 'mindmap-open-mode';

export function rememberedOpenMode(): OpenMode | null {
  try { const v = localStorage.getItem(MODE_KEY); return v === 'preview' || v === 'convert' ? v : null; } catch { return null; }
}
export function forgetOpenMode() { try { localStorage.removeItem(MODE_KEY); } catch { /* 忽略 */ } }

/** 打開別人的檔案時：預覽（唯讀）或轉換成可編輯 */
export function chooseOpenMode(fileName: string, detail: string): Promise<OpenMode | null> {
  const remembered = rememberedOpenMode();
  if (remembered) return Promise.resolve(remembered);
  return modal<OpenMode | null>(close => {
    const remember = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const pick = (m: OpenMode) => {
      if (remember.checked) try { localStorage.setItem(MODE_KEY, m); } catch { /* 忽略 */ }
      close(m);
    };
    const option = (m: OpenMode, icon: string, title: string, desc: string, primary = false) =>
      h('button', { class: 'choice' + (primary ? ' primary' : ''), onclick: () => pick(m), ...(primary ? { 'data-autofocus': '' } : {}) },
        h('span', { class: 'choice-title' }, `${icon}  ${title}`),
        h('span', { class: 'choice-desc' }, desc));
    return h('div', { class: 'modal', role: 'dialog' },
      h('h2', { class: 'file-title' }, fileName),
      h('p', { class: 'modal-sub' }, detail),
      option('preview', '👁', '預覽（唯讀）', '只看不改，原檔不會變', true),
      option('convert', '✎', '轉換成可編輯', '另存一份新導圖到「我的導圖」，原檔保留'),
      h('label', { class: 'remember' }, remember, '記住這個選擇'),
    );
  }, null);
}

export interface MenuItem { label: string; hint?: string; action: () => void }

/** 在按鈕下方展開的選單 */
export function showMenu(anchor: HTMLElement, items: MenuItem[]) {
  document.querySelector('.menu')?.remove();
  const menu = h('div', { class: 'menu', role: 'menu' },
    ...items.map(it => h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { menu.remove(); it.action(); } },
      h('span', {}, it.label), it.hint ? h('span', { class: 'menu-hint' }, it.hint) : '')));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + 'px';
  menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
  setTimeout(() => {
    const off = (e: Event) => { if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('pointerdown', off); } };
    document.addEventListener('pointerdown', off);
  });
}

let toastTimer = 0;
export function toast(msg: string) {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) { el = h('div', { class: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2200);
}
