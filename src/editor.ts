import type { MapNode, MindMapDoc } from './types';
import { newNode } from './model';
import { parseOutline } from './formats';
import { lookupTerm, fetchTerm, type Choice } from './terms';

const PALETTE = ['#ef6461', '#f4a259', '#e2b93b', '#5cb85c', '#4ea8de', '#8e7dbe', '#e07bb5', '#2ec4b6'];
const GAPX = 56, GAPY = 14;

export interface NodeView {
  n: MapNode;
  p: MapNode | null;
  depth: number;
  color: string;
  /** 0 = 中心主題，1 = 右側，-1 = 左側 */
  side: number;
  el: HTMLElement;
  noteEl: HTMLElement | null;
  /** 主題框＋備註整體的左緣與寬度；y 是垂直中心 */
  x: number; y: number; w: number; h: number;
  /** 主題框寬度、備註寬度 */
  bw: number; nw: number;
  /** 子樹高度 */
  sh: number;
}

export interface EditorOptions {
  readonly?: boolean;
  /** 文件內容變了（需要儲存） */
  onChange?: () => void;
  /** 縮放比例變了 */
  onView?: (scale: number) => void;
  /** 復原／重做的可用狀態變了 */
  onHistory?: (canUndo: boolean, canRedo: boolean) => void;
  openUrl?: (url: string) => void;
}

interface TermState { loading?: boolean; error?: string; choices?: Choice[] }

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const sideOf = (c: MapNode) => (c.side === 'L' ? -1 : 1);

export class MindMapEditor {
  doc: MindMapDoc;
  readonly: boolean;
  selected: string;
  view = { x: 0, y: 0, s: 1 };

  private opts: EditorOptions;
  private host: HTMLElement;
  private stage: HTMLElement;
  private world: HTMLElement;
  private edgesEl: SVGSVGElement;
  private nodesEl: HTMLElement;
  private card: HTMLElement;
  private markBtn: HTMLButtonElement;

  private views = new Map<string, NodeView>();
  private visible: NodeView[] = [];
  private editing: string | null = null;
  private noteEditId: string | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private cardTerm: string | null = null;
  private cardAnchor: HTMLElement | null = null;
  private termState = new Map<string, TermState>();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; s: number } | null = null;
  private lastTap = { id: '', t: 0 };
  /** 開始編輯時會自動全選文字，這段時間內的選取變化不顯示「標註名詞」 */
  private autoSelectUntil = 0;
  private cleanup: (() => void)[] = [];

  constructor(host: HTMLElement, doc: MindMapDoc, opts: EditorOptions = {}) {
    this.host = host;
    this.doc = doc;
    this.opts = opts;
    this.readonly = !!opts.readonly;
    this.selected = doc.root.id;

    host.classList.add('mm-host');
    host.classList.toggle('readonly', this.readonly);
    host.innerHTML = '<div class="mm-stage"><div class="mm-world"><svg class="mm-edges" width="1" height="1"></svg><div class="mm-nodes"></div></div></div>';
    this.stage = host.querySelector('.mm-stage')!;
    this.world = host.querySelector('.mm-world')!;
    this.edgesEl = host.querySelector('.mm-edges')!;
    this.nodesEl = host.querySelector('.mm-nodes')!;

    this.markBtn = Object.assign(document.createElement('button'), { className: 'mm-mark', textContent: '標註名詞', hidden: true });
    this.card = Object.assign(document.createElement('div'), { className: 'mm-card', hidden: true });
    document.body.append(this.markBtn, this.card);

    this.bindEvents();
    this.render();
    this.fit();
  }

  destroy() {
    this.cleanup.forEach(f => f());
    this.card.remove();
    this.markBtn.remove();
    this.host.innerHTML = '';
  }

  private on<K extends keyof HTMLElementEventMap>(target: EventTarget, type: K | string, fn: (e: any) => void, o?: AddEventListenerOptions) {
    target.addEventListener(type, fn, o);
    this.cleanup.push(() => target.removeEventListener(type, fn, o));
  }

  /* ---------- 歷史 ---------- */

  private snap() { return JSON.stringify({ root: this.doc.root, terms: this.doc.terms }); }
  private restore(s: string) { const d = JSON.parse(s); this.doc.root = d.root; this.doc.terms = d.terms; }
  private changed() {
    this.opts.onChange?.();
    this.opts.onHistory?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }
  private commit(fn: () => void) {
    if (this.readonly) return;
    this.undoStack.push(this.snap());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    fn();
    this.changed();
    this.render();
  }
  undo() {
    if (this.readonly || !this.undoStack.length) return;
    this.redoStack.push(this.snap());
    this.restore(this.undoStack.pop()!);
    this.changed(); this.render();
  }
  redo() {
    if (this.readonly || !this.redoStack.length) return;
    this.undoStack.push(this.snap());
    this.restore(this.redoStack.pop()!);
    this.changed(); this.render();
  }

  /* ---------- 渲染 ---------- */

  render() {
    // 重建 DOM 會移除正在編輯的元素，且不會觸發 blur，所以在這裡結束編輯狀態
    this.editing = null;
    this.markBtn.hidden = true;
    const root = this.doc.root;

    this.views.clear();
    const all: NodeView[] = [];
    const walk = (n: MapNode, p: MapNode | null, depth: number, color: string, side: number) => {
      const v = { n, p, depth, color, side } as NodeView;
      this.views.set(n.id, v);
      all.push(v);
      n.children.forEach((c, i) => walk(c, n, depth + 1, depth === 0 ? PALETTE[i % PALETTE.length] : color, depth === 0 ? sideOf(c) : side));
    };
    walk(root, null, 0, 'var(--root)', 0);

    if (!this.views.has(this.selected)) this.selected = root.id;
    for (let v = this.views.get(this.selected)!; v.p; v = this.views.get(v.p.id)!) if (v.p.collapsed) this.selected = v.p.id;

    this.nodesEl.innerHTML = '';
    this.visible = [];
    const build = (n: MapNode) => {
      const v = this.views.get(n.id)!;
      const el = document.createElement('div');
      el.className = 'mm-node' + (n === root ? ' root' : v.depth === 1 ? ' d1' : '') + (n.id === this.selected ? ' selected' : '');
      el.dataset.id = n.id;
      el.style.setProperty('--c', v.color);
      const t = document.createElement('span');
      t.className = 'mm-text';
      this.rich(t, n.text);
      el.appendChild(t);
      if (n !== root && n.children.length) {
        const b = this.button('mm-toggle ' + (v.side < 0 ? 'l' : 'r') + (n.collapsed ? '' : ' open'), n.collapsed ? '展開' : '摺疊', () => this.toggle(n.id));
        b.textContent = n.collapsed ? String(n.children.length) : '−';
        el.appendChild(b);
      }
      if (!this.readonly) {
        if (n === root) {
          // 中心主題左右各一個 +，分別往左、往右長
          el.appendChild(this.button('mm-add l', '在左邊新增子主題', () => { this.select(n.id); this.addChild('L'); }));
          el.appendChild(this.button('mm-add r', '在右邊新增子主題', () => { this.select(n.id); this.addChild('R'); }));
        } else {
          el.appendChild(this.button('mm-add ' + (v.side < 0 ? 'l' : 'r'), '新增子主題', () => { this.select(n.id); this.addChild(); }));
        }
        if (n !== root) el.appendChild(this.button('mm-del ' + (v.side < 0 ? 'l' : 'r'), '刪除', () => { this.select(n.id); this.removeSelected(); }));
        if (!n.note && this.noteEditId !== n.id) {
          const memo = this.button('mm-memo', '新增備註 (N)', () => this.editNote(n.id));
          memo.textContent = '✎ 備註';
          el.appendChild(memo);
        }
      }
      this.nodesEl.appendChild(el);
      v.el = el;
      v.noteEl = null;
      if (n.note || this.noteEditId === n.id) {
        const note = document.createElement('div');
        note.className = 'mm-note';
        note.dataset.id = n.id;
        note.style.setProperty('--c', v.color);
        this.rich(note, n.note || '');
        this.nodesEl.appendChild(note);
        v.noteEl = note;
      }
      this.visible.push(v);
      if (!n.collapsed) n.children.forEach(build);
    };
    build(root);
    this.relayout();
    if (!this.card.hidden) this.placeCard();
  }

  private button(cls: string, label: string, fn: () => void) {
    const b = document.createElement('button');
    b.className = cls;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  }

  /** 把已標註的名詞包成 <span class="mm-term"> */
  private rich(el: HTMLElement, text: string) {
    const keys = Object.keys(this.doc.terms).sort((a, b) => b.length - a.length);
    if (!keys.length) { el.textContent = text; return; }
    const re = new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    let last = 0;
    for (const m of text.matchAll(re)) {
      el.append(text.slice(last, m.index));
      const span = document.createElement('span');
      span.className = 'mm-term';
      span.textContent = m[0];
      span.dataset.term = keys.find(k => k.toLowerCase() === m[0].toLowerCase());
      el.append(span);
      last = m.index! + m[0].length;
    }
    el.append(text.slice(last));
  }

  private measureH(v: NodeView): number {
    const n = v.n;
    if (n.collapsed || !n.children.length) return (v.sh = v.h);
    const s = n.children.reduce((a, c) => a + this.measureH(this.views.get(c.id)!), 0) + GAPY * (n.children.length - 1);
    return (v.sh = Math.max(v.h, s));
  }

  private placeKids(kids: NodeView[], parent: NodeView, side: number) {
    const total = kids.reduce((a, c) => a + c.sh, 0) + GAPY * (kids.length - 1);
    let y = parent.y - total / 2;
    for (const c of kids) {
      c.y = y + c.sh / 2;
      c.x = side > 0 ? parent.x + parent.w + GAPX : parent.x - GAPX - c.w;
      if (!c.n.collapsed) this.placeKids(c.n.children.map(k => this.views.get(k.id)!), c, side);
      y += c.sh + GAPY;
    }
  }

  private relayout() {
    for (const v of this.visible) {
      v.bw = v.el.offsetWidth;
      v.h = v.el.offsetHeight;
      v.nw = v.noteEl ? v.noteEl.offsetWidth : 0;
      v.w = v.bw + v.nw;
    }
    const root = this.views.get(this.doc.root.id)!;
    const kids = root.n.children.map(c => this.views.get(c.id)!);
    kids.forEach(k => this.measureH(k));
    root.x = -root.w / 2; root.y = 0;
    this.placeKids(kids.filter(k => k.side > 0), root, 1);
    this.placeKids(kids.filter(k => k.side < 0), root, -1);

    let paths = '';
    for (const v of this.visible) {
      const left = v.side < 0;
      v.el.style.left = (left ? v.x + v.nw : v.x) + 'px';
      v.el.style.top = v.y + 'px';
      if (v.noteEl) {
        v.noteEl.style.left = (left ? v.x : v.x + v.bw) + 'px';
        v.noteEl.style.top = v.y + 'px';
      }
      // 有備註時，+ 和摺疊按鈕移到底線末端
      for (const b of v.el.querySelectorAll<HTMLElement>('.mm-add, .mm-toggle')) {
        if (!b.classList.contains(left ? 'l' : 'r')) continue;
        const off = b.classList.contains('mm-add') ? 13 : 12;
        b.style[left ? 'left' : 'right'] = v.nw ? -(v.nw + off) + 'px' : '';
      }
      if (!v.p) continue;
      const p = this.views.get(v.p.id)!;
      const x1 = v.side > 0 ? p.x + p.w : p.x, y1 = p.y;
      const x2 = v.side > 0 ? v.x : v.x + v.w, y2 = v.y;
      const mx = (x1 + x2) / 2;
      paths += `<path d="M${x1} ${y1}C${mx} ${y1},${mx} ${y2},${x2} ${y2}" stroke="${v.color}" stroke-width="${v.depth === 1 ? 3 : 2}"/>`;
    }
    this.edgesEl.innerHTML = paths;
  }

  /** 目前可見主題的版面資料（匯出圖片用） */
  layout(): NodeView[] { return this.visible; }

  /* ---------- 視圖 ---------- */

  private applyView() {
    this.world.style.transform = `translate(${this.view.x}px,${this.view.y}px) scale(${this.view.s})`;
    if (!this.card.hidden) this.placeCard();
    this.opts.onView?.(this.view.s);
  }

  /** 以畫面上的某點為中心縮放；不給座標時以畫布中心縮放 */
  zoom(f: number, clientX?: number, clientY?: number) {
    const r = this.host.getBoundingClientRect();
    const cx = (clientX ?? r.left + r.width / 2) - r.left, cy = (clientY ?? r.top + r.height / 2) - r.top;
    const s = Math.min(3, Math.max(0.2, this.view.s * f));
    f = s / this.view.s;
    this.view.x = cx - (cx - this.view.x) * f;
    this.view.y = cy - (cy - this.view.y) * f;
    this.view.s = s;
    this.applyView();
  }

  fit() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !this.visible.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const v of this.visible) {
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x + v.w);
      y0 = Math.min(y0, v.y - v.h / 2); y1 = Math.max(y1, v.y + v.h / 2);
    }
    const padX = 40, top = 70, bottom = 80, w = x1 - x0, h = y1 - y0;
    this.view.s = Math.max(0.2, Math.min(1.2, (r.width - padX * 2) / w, (r.height - top - bottom) / h));
    this.view.x = r.width / 2 - (x0 + w / 2) * this.view.s;
    this.view.y = top + (r.height - top - bottom) / 2 - (y0 + h / 2) * this.view.s;
    this.applyView();
  }

  private ensureVisible(v: NodeView) {
    const h = this.host.getBoundingClientRect(), r = v.el.getBoundingClientRect();
    const m = 40;
    let dx = 0, dy = 0;
    if (r.left < h.left + m) dx = h.left + m - r.left; else if (r.right > h.right - m) dx = h.right - m - r.right;
    if (r.top < h.top + 70) dy = h.top + 70 - r.top; else if (r.bottom > h.bottom - 80) dy = h.bottom - 80 - r.bottom;
    if (dx || dy) { this.view.x += dx; this.view.y += dy; this.applyView(); }
  }

  select(id: string) {
    this.selected = id;
    this.nodesEl.querySelectorAll<HTMLElement>('.mm-node').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  }

  /* ---------- 編輯操作 ---------- */

  private cur() { return this.views.get(this.selected)!; }

  private lighterSide(): 'L' | 'R' {
    const kids = this.doc.root.children;
    const r = kids.filter(c => c.side !== 'L').length;
    return r <= kids.length - r ? 'R' : 'L';
  }

  /** side 只對中心主題有效：指定往左或往右長，不指定就放到比較少的那邊 */
  addChild(side?: 'L' | 'R') {
    if (this.readonly) return;
    const { n } = this.cur();
    const c = newNode('新主題', n === this.doc.root ? side || this.lighterSide() : undefined);
    this.commit(() => { n.collapsed = false; n.children.push(c); this.selected = c.id; });
    this.edit(c.id);
  }

  addSibling() {
    if (this.readonly) return;
    const { n, p } = this.cur();
    if (!p) return this.addChild();
    const c = newNode('新主題', p === this.doc.root ? n.side || 'R' : undefined);
    this.commit(() => { p.children.splice(p.children.indexOf(n) + 1, 0, c); this.selected = c.id; });
    this.edit(c.id);
  }

  removeSelected() {
    const { n, p } = this.cur();
    if (this.readonly || !p) return;
    const i = p.children.indexOf(n);
    this.commit(() => {
      p.children.splice(i, 1);
      this.selected = (p.children[i] || p.children[i - 1] || p).id;
    });
  }

  toggle(id: string) {
    const v = this.views.get(id);
    if (!v || !v.n.children.length || !v.p) return;
    // 唯讀模式也能摺疊，但只改畫面、不算修改文件
    if (this.readonly) { v.n.collapsed = !v.n.collapsed; this.render(); }
    else this.commit(() => { v.n.collapsed = !v.n.collapsed; });
  }

  private moveNode(id: string, targetId: string) {
    const { n, p } = this.views.get(id)!, t = this.views.get(targetId)!.n;
    this.commit(() => {
      p!.children.splice(p!.children.indexOf(n), 1);
      if (t === this.doc.root) n.side = this.lighterSide(); else delete n.side;
      t.collapsed = false;
      t.children.push(n);
      this.selected = n.id;
    });
  }

  /** 把多行文字（條列、縮排、Markdown）變成目前主題的子主題 */
  pasteOutline(text: string) {
    if (this.readonly || !text.trim()) return;
    const parsed = parseOutline(text, '');
    const items = parsed.text ? [parsed] : parsed.children;
    if (!items.length) return;
    const { n } = this.cur();
    this.commit(() => {
      n.collapsed = false;
      for (const c of items) {
        if (n === this.doc.root) c.side = this.lighterSide();
        n.children.push(c);
      }
      this.selected = items[0].id;
    });
  }

  private nav(dir: 'up' | 'down' | 'left' | 'right') {
    const { n, p, side } = this.cur();
    const root = this.doc.root;
    const kidsOn = (s: number) => (n.collapsed ? [] : n === root ? n.children.filter(c => sideOf(c) === s) : n.children);
    let t: MapNode | undefined;
    if (dir === 'up' || dir === 'down') {
      if (!p) return;
      const sibs = p === root ? p.children.filter(c => sideOf(c) === side) : p.children;
      t = sibs[sibs.indexOf(n) + (dir === 'up' ? -1 : 1)];
    } else {
      const d = dir === 'right' ? 1 : -1;
      if (n === root) t = kidsOn(d)[0];
      else if (d === side) { const k = kidsOn(side); t = k[Math.floor((k.length - 1) / 2)]; }
      else t = p || undefined;
    }
    if (t) { this.select(t.id); this.ensureVisible(this.views.get(t.id)!); }
  }

  /* ---------- 文字編輯 ---------- */

  editNote(id = this.selected) {
    if (this.readonly || !this.views.has(id)) return;
    this.noteEditId = id;
    this.render();
    this.edit(id, true);
  }

  edit(id = this.selected, isNote = false) {
    const v = this.views.get(id);
    if (this.readonly || !v || (this.editing === id && !isNote)) return;
    const n = v.n;
    const t = isNote ? v.noteEl! : v.el.querySelector<HTMLElement>('.mm-text')!;
    this.ensureVisible(v);
    this.hideCard();
    t.textContent = isNote ? n.note || '' : n.text;
    this.editing = id;
    t.contentEditable = 'plaintext-only';
    if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
    t.focus();
    const range = document.createRange();
    range.selectNodeContents(t);
    const sel = getSelection()!;
    this.autoSelectUntil = Date.now() + 400;
    sel.removeAllRanges();
    sel.addRange(range);

    const done = (ok: boolean) => {
      if (this.editing !== id) return;
      this.editing = null;
      this.markBtn.hidden = true;
      const val = t.innerText.replace(/\n+$/, '').trim();
      if (isNote) {
        this.noteEditId = null;
        if (ok && val !== (n.note || '')) this.commit(() => { if (val) n.note = val; else delete n.note; });
        else this.render();
      } else if (ok && val && val !== n.text) this.commit(() => { n.text = val; });
      else this.render();
    };
    t.addEventListener('input', () => this.relayout());
    t.addEventListener('blur', () => done(true));
    t.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return; // 中文輸入法選字中
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Tab') { e.preventDefault(); done(true); this.addChild(); }
    });
  }

  /* ---------- 滑鼠、觸控、鍵盤 ---------- */

  private bindEvents() {
    const stage = this.stage;

    this.on(stage, 'pointerdown', (e: PointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) { this.startPinch(); return; }
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const term = target.closest<HTMLElement>('.mm-term');
      if (term && !this.editing) {
        this.select(term.closest<HTMLElement>('[data-id]')!.dataset.id!);
        this.showCard(term.dataset.term!, term);
        return;
      }
      this.hideCard();
      if (target.closest('.mm-toggle,.mm-add,.mm-del,.mm-memo')) return;
      const note = target.closest<HTMLElement>('.mm-note');
      if (note) {
        if (this.editing !== note.dataset.id) { this.select(note.dataset.id!); }
        return;
      }
      const el = target.closest<HTMLElement>('.mm-node');
      if (el) {
        if (el.dataset.id === this.editing) return;
        this.select(el.dataset.id!);
        this.startNodeDrag(e, el.dataset.id!);
      } else this.startPan(e);
    });
    const release = (e: PointerEvent) => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = null; };
    this.on(window, 'pointerup', release);
    this.on(window, 'pointercancel', release);
    this.on(stage, 'pointermove', (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom((this.pinch.s * d) / this.pinch.d / this.view.s, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    });

    // 點備註：開始編輯備註
    this.on(stage, 'click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const note = target.closest<HTMLElement>('.mm-note');
      if (note && !target.closest('.mm-term') && this.editing !== note.dataset.id) this.editNote(note.dataset.id!);
    });
    // 滑鼠雙擊、手機連點兩下：編輯主題文字
    this.on(stage, 'dblclick', (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.mm-node');
      if (el && !(e.target as HTMLElement).closest('button')) this.edit(el.dataset.id!);
    });
    this.on(stage, 'pointerup', (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('.mm-node');
      if (!el || (e.target as HTMLElement).closest('button')) return;
      const now = Date.now();
      if (this.lastTap.id === el.dataset.id && now - this.lastTap.t < 350) { this.edit(el.dataset.id!); this.lastTap.t = 0; }
      else this.lastTap = { id: el.dataset.id!, t: now };
    });

    this.on(stage, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else { this.view.x -= e.deltaX; this.view.y -= e.deltaY; this.applyView(); }
    }, { passive: false });

    this.on(document, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    this.on(document, 'paste', (e: ClipboardEvent) => {
      if (this.editing || this.readonly || !this.host.isConnected) return;
      if ((e.target as HTMLElement).closest?.('input,textarea,[contenteditable]')) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text) { e.preventDefault(); this.pasteOutline(text); }
    });

    // 名詞標註：編輯文字時選取一段字，上方浮出「標註名詞」
    this.on(document, 'selectionchange', () => {
      const sel = getSelection()!;
      const el = this.editing && document.activeElement;
      const word = sel.toString().trim();
      if (Date.now() < this.autoSelectUntil) { this.markBtn.hidden = true; return; }
      if (!el || sel.isCollapsed || !el.contains(sel.anchorNode) || !word || word.length > 40 || word.includes('\n')) {
        this.markBtn.hidden = true;
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      this.markBtn.style.left = r.left + r.width / 2 + 'px';
      this.markBtn.style.top = r.top - 8 + 'px';
      this.markBtn.hidden = false;
    });
    this.markBtn.addEventListener('mousedown', e => e.preventDefault()); // 保留選取範圍
    this.markBtn.addEventListener('click', () => {
      const word = getSelection()!.toString().trim();
      this.markBtn.hidden = true;
      (document.activeElement as HTMLElement)?.blur(); // 先存下正在編輯的文字
      if (!word) return;
      if (!this.doc.terms[word]) this.commit(() => { this.doc.terms[word] = {}; });
      this.showCard(word);
    });
    this.card.addEventListener('click', e => this.onCardClick(e));
    this.on(document, 'pointerdown', (e: PointerEvent) => {
      if (!this.card.hidden && !this.card.contains(e.target as Node) && !this.stage.contains(e.target as Node)) this.hideCard();
    });
    this.on(window, 'resize', () => this.applyView());
    // 手機鍵盤彈出、可見區域變小時，讓正在編輯的主題保持在畫面內
    this.on(window.visualViewport || window, 'resize', () => {
      const v = this.editing && this.views.get(this.editing);
      if (v) requestAnimationFrame(() => this.ensureVisible(v));
    });
  }

  private onKey(e: KeyboardEvent) {
    if (this.editing || !this.host.isConnected) return;
    if ((e.target as HTMLElement).closest?.('input,textarea,select,dialog')) return;
    if (e.key === 'Escape' && !this.card.hidden) { this.hideCard(); return; }
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod) return;
    const view: Record<string, () => void> = {
      ArrowUp: () => this.nav('up'), ArrowDown: () => this.nav('down'),
      ArrowLeft: () => this.nav('left'), ArrowRight: () => this.nav('right'),
      '=': () => this.zoom(1.2), '+': () => this.zoom(1.2), '-': () => this.zoom(1 / 1.2), '0': () => this.fit(),
      '/': () => this.toggle(this.selected),
    };
    const editing: Record<string, () => void> = {
      Tab: () => this.addChild(), Insert: () => this.addChild(), Enter: () => this.addSibling(),
      Delete: () => this.removeSelected(), Backspace: () => this.removeSelected(),
      ' ': () => this.edit(), F2: () => this.edit(), n: () => this.editNote(), N: () => this.editNote(),
    };
    const act = view[e.key] || (!this.readonly && editing[e.key]);
    if (act) { e.preventDefault(); act(); }
  }

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: this.view.s };
  }

  private startPan(e: PointerEvent) {
    this.stage.classList.add('panning');
    let lx = e.clientX, ly = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || this.pinch) return;
      this.view.x += ev.clientX - lx; this.view.y += ev.clientY - ly;
      lx = ev.clientX; ly = ev.clientY;
      this.applyView();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      this.stage.classList.remove('panning');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  private startNodeDrag(e: PointerEvent, id: string) {
    if (this.readonly || id === this.doc.root.id) return;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, target: string | null = null;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (this.pinch) return cancel();
      if (!dragging && Math.hypot(dx, dy) < 6) return;
      const v = this.views.get(id);
      if (!v || this.editing) return;
      if (!dragging) { dragging = true; v.el.classList.add('dragging'); v.noteEl?.classList.add('dragging'); document.body.classList.add('is-dragging'); }
      for (const el of [v.el, v.noteEl]) if (el) el.style.translate = `${dx / this.view.s}px ${dy / this.view.s}px`;
      this.nodesEl.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.mm-node');
      target = null;
      if (under && !this.isInside(id, under.dataset.id!) && under.dataset.id !== v.p!.id) {
        target = under.dataset.id!;
        under.classList.add('drop');
      }
    };
    const cancel = () => { target = null; finish(); };
    const finish = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      if (!dragging) return;
      document.body.classList.remove('is-dragging');
      if (target) this.moveNode(id, target); else this.render();
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) finish(); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  }

  private isInside(ancestorId: string, id: string) {
    for (let v = this.views.get(id); v; v = v.p ? this.views.get(v.p.id) : undefined) if (v.n.id === ancestorId) return true;
    return false;
  }

  /* ---------- 名詞解釋卡片 ---------- */

  private st(term: string) {
    let s = this.termState.get(term);
    if (!s) this.termState.set(term, (s = {}));
    return s;
  }
  private findTermSpan(term: string) {
    return [...this.nodesEl.querySelectorAll<HTMLElement>('.mm-term')].find(s => s.dataset.term === term) || null;
  }
  private showCard(term: string, anchor?: HTMLElement) {
    const d = this.doc.terms[term];
    if (!d) return;
    this.cardTerm = term;
    this.cardAnchor = anchor || this.findTermSpan(term);
    this.card.hidden = false;
    this.drawCard();
    this.placeCard();
    const s = this.st(term);
    if (!d.extract && !s.choices && !s.error && !s.loading) this.lookup(term);
  }
  private hideCard() { this.card.hidden = true; this.cardTerm = null; }
  private placeCard() {
    if (!this.cardAnchor?.isConnected) this.cardAnchor = this.cardTerm ? this.findTermSpan(this.cardTerm) : null;
    if (!this.cardAnchor || !this.cardTerm || !this.doc.terms[this.cardTerm]) return this.hideCard();
    const r = this.cardAnchor.getBoundingClientRect(), w = this.card.offsetWidth, h = this.card.offsetHeight;
    const x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
    let y = r.bottom + 10;
    if (y + h > innerHeight - 12) y = Math.max(12, r.top - h - 10);
    this.card.style.left = x + 'px';
    this.card.style.top = y + 'px';
  }
  private drawCard() {
    const term = this.cardTerm!, d = this.doc.terms[term];
    if (!d) return this.hideCard();
    const s = this.st(term);
    let body: string;
    if (d.extract) {
      body = (d.thumb ? `<img src="${esc(d.thumb)}" alt="">` : '') +
        `<div class="t">${esc(d.title)}</div><p>${esc(d.extract)}</p><a href="${esc(d.url)}" class="wiki-link">在維基百科閱讀 ↗</a>`;
    } else if (s.choices) {
      body = `<div class="t">「${esc(term)}」有好幾個意思，選一個：</div>` +
        s.choices.map((c, i) => `<button class="opt" data-i="${i}"><b>${esc(c.title)}</b><span>${esc(c.snippet)}</span></button>`).join('');
    } else if (s.error) {
      body = `<div class="t">${esc(term)}</div><p class="muted">${esc(s.error)}</p><button class="retry">重試</button>`;
    } else {
      body = `<div class="t">${esc(term)}</div><p class="muted">正在查詢維基百科…</p>`;
    }
    const actions = this.readonly ? '' :
      (d.extract ? '<button class="link rechoose">換一個意思</button>' : '') + '<button class="link unmark">取消標註</button>';
    this.card.innerHTML = body + `<div class="foot"><span>來源：維基百科</span><span class="actions">${actions}</span></div>`;
  }
  private refreshCard(term: string) {
    if (this.cardTerm === term && !this.card.hidden) { this.drawCard(); this.placeCard(); }
  }
  private async lookup(term: string, forceChoose = false) {
    const s = this.st(term);
    Object.assign(s, { loading: true, error: undefined, choices: undefined });
    this.refreshCard(term);
    try {
      const r = await lookupTerm(term, forceChoose);
      if ('info' in r) this.storeTerm(term, r.info); else s.choices = r.choices;
    } catch (e: any) {
      s.error = e instanceof TypeError ? '連不上維基百科，請檢查網路後重試。' : e.message;
    } finally { s.loading = false; }
    this.refreshCard(term);
  }
  private async choose(term: string, title: string) {
    const s = this.st(term);
    Object.assign(s, { loading: true, choices: undefined });
    this.refreshCard(term);
    try { this.storeTerm(term, await fetchTerm(title)); }
    catch (e: any) { s.error = e instanceof TypeError ? '連不上維基百科，請檢查網路後重試。' : e.message; }
    finally { s.loading = false; }
    this.refreshCard(term);
  }
  /** 查到的解釋存進文件，但不算一個可以復原的步驟 */
  private storeTerm(term: string, info: object) {
    if (!this.doc.terms[term]) return;
    this.doc.terms[term] = info;
    this.termState.delete(term);
    if (!this.readonly) this.opts.onChange?.();
  }
  private onCardClick(e: MouseEvent) {
    const term = this.cardTerm;
    if (!term) return;
    const t = e.target as HTMLElement;
    const opt = t.closest<HTMLElement>('.opt');
    if (opt) this.choose(term, this.st(term).choices![+opt.dataset.i!].title);
    else if (t.closest('.retry')) this.lookup(term);
    else if (t.closest('.wiki-link')) {
      e.preventDefault();
      const url = (t.closest('a') as HTMLAnchorElement).href;
      this.opts.openUrl ? this.opts.openUrl(url) : window.open(url, '_blank', 'noopener');
    } else if (t.closest('.rechoose')) {
      this.doc.terms[term] = {};
      this.opts.onChange?.();
      this.lookup(term, true);
    } else if (t.closest('.unmark')) {
      this.hideCard();
      this.commit(() => { delete this.doc.terms[term]; });
    }
  }
}
