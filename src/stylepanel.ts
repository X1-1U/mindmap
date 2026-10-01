import type { MindMapEditor } from './editor';
import type { FontKey, NodeStyle } from './types';
import { FONTS } from './styles';
import { h } from './ui';

const SWATCHES = ['#ef6461', '#f4a259', '#e2b93b', '#5cb85c', '#4ea8de', '#8e7dbe', '#e07bb5', '#2ec4b6', '#1f2330', '#6b7280', '#ffffff'];

/** 選取主題的樣式面板：對齊、字體、顏色、大小 */
export function createStylePanel(getEditor: () => MindMapEditor | null) {
  const ed = () => getEditor();
  const set = (patch: Partial<NodeStyle>, preview = false) => ed()?.setStyle(patch, preview);

  const seg = <T extends string>(items: [T, string, string][], key: 'align' | 'valign') => {
    const wrap = h('div', { class: 'sp-seg', role: 'group' });
    const buttons = items.map(([val, label, title]) =>
      h('button', { title, 'aria-label': title, 'data-val': val, onclick: () => set({ [key]: val }) }, label));
    wrap.append(...buttons);
    return { el: wrap, update: (cur: string) => buttons.forEach(b => b.classList.toggle('on', b.dataset.val === cur)) };
  };

  const colorRow = (key: 'color' | 'fill' | 'border') => {
    const swatches = SWATCHES.map(c => h('button', { class: 'sp-swatch', title: c, 'aria-label': c, style: `background:${c}`, 'data-c': c, onclick: () => set({ [key]: c }) }));
    const reset = h('button', { class: 'sp-swatch default', title: '預設', 'aria-label': '恢復預設顏色', onclick: () => set({ [key]: undefined }) });
    const custom = h('input', { type: 'color', class: 'sp-custom', title: '自訂顏色', 'aria-label': '自訂顏色' }) as HTMLInputElement;
    custom.addEventListener('input', () => set({ [key]: custom.value }, true));
    custom.addEventListener('change', () => set({ [key]: custom.value }));
    return {
      el: h('div', { class: 'sp-swatches' }, reset, ...swatches, custom),
      update: (cur?: string) => {
        reset.classList.toggle('on', !cur);
        swatches.forEach(s => s.classList.toggle('on', s.dataset.c === cur));
        if (cur && /^#[0-9a-f]{6}$/i.test(cur)) custom.value = cur;
      },
    };
  };

  const align = seg<'left' | 'center' | 'right'>([['left', '左', '靠左'], ['center', '中', '水平置中'], ['right', '右', '靠右']], 'align');
  const valign = seg<'top' | 'middle' | 'bottom'>([['top', '上', '靠上'], ['middle', '中', '垂直置中'], ['bottom', '下', '靠下']], 'valign');

  const font = h('select', { class: 'sp-select', 'aria-label': '字體' },
    h('option', { value: '' }, '預設字體'),
    ...Object.entries(FONTS).map(([k, f]) => h('option', { value: k }, f.label))) as HTMLSelectElement;
  font.addEventListener('change', () => set({ font: (font.value || undefined) as FontKey | undefined }));

  const sizeLabel = h('span', { class: 'sp-size' }, '—');
  const curSize = () => ed()?.getStyle().size;
  const bump = (d: number) => {
    const base = curSize() ?? (Math.round(parseFloat(getComputedStyle(document.querySelector('.mm-node.selected')!).fontSize)) || 14);
    set({ size: Math.min(48, Math.max(10, base + d)) });
  };
  const bold = h('button', { class: 'sp-btn', title: '粗體', onclick: () => {
    const el = document.querySelector('.mm-node.selected');
    const isBold = ed()?.getStyle().bold ?? (el ? parseInt(getComputedStyle(el).fontWeight) >= 600 : false);
    set({ bold: !isBold });
  } }, h('b', {}, 'B'));

  const colors = { color: colorRow('color'), fill: colorRow('fill'), border: colorRow('border') };
  const sizeText = h('span', { class: 'sp-hint' });

  const row = (label: string, ...children: (Node | string)[]) =>
    h('div', { class: 'sp-row' }, h('span', { class: 'sp-label' }, label), ...children);

  const panel = h('aside', { class: 'style-panel', 'aria-label': '主題樣式', hidden: '' },
    h('div', { class: 'sp-head' }, '主題樣式', h('button', { class: 'sp-close', 'aria-label': '關閉', onclick: () => toggle(false) }, '×')),
    row('文字對齊', h('div', { class: 'sp-inline' }, align.el, valign.el)),
    row('字體', h('div', { class: 'sp-inline' }, font,
      h('button', { class: 'sp-btn', title: '縮小字級', onclick: () => bump(-1) }, 'A−'), sizeLabel,
      h('button', { class: 'sp-btn', title: '放大字級', onclick: () => bump(1) }, 'A＋'), bold)),
    row('文字顏色', colors.color.el),
    row('填充顏色', colors.fill.el),
    row('框線顏色', colors.border.el),
    row('框的大小', h('div', { class: 'sp-inline' }, sizeText,
      h('button', { class: 'sp-btn', onclick: () => set({ w: undefined, h: undefined }) }, '自動大小'))),
    h('div', { class: 'sp-foot sp-inline' },
      h('button', { class: 'sp-btn', onclick: () => ed()?.setStyle({ w: undefined, h: undefined, align: undefined, valign: undefined, font: undefined, size: undefined, bold: undefined, color: undefined, fill: undefined, border: undefined }) }, '全部恢復預設')),
  );
  // 面板按鈕不搶走焦點，避免中斷文字編輯
  panel.addEventListener('mousedown', e => { if (!(e.target as HTMLElement).closest('select,input')) e.preventDefault(); });

  function refresh() {
    if (panel.hidden || !ed()) return;
    const s = ed()!.getStyle();
    align.update(s.align || 'center');
    valign.update(s.valign || 'middle');
    font.value = s.font || '';
    const el = document.querySelector<HTMLElement>('.mm-node.selected');
    sizeLabel.textContent = String(s.size ?? (el ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : '—'));
    colors.color.update(s.color);
    colors.fill.update(s.fill);
    colors.border.update(s.border);
    sizeText.textContent = s.w || s.h ? `${s.w ?? '自動'} × ${s.h ?? '自動'}` : '依文字自動調整（拖曳右下角可拉伸）';
  }

  function toggle(force?: boolean) {
    panel.hidden = !(force ?? panel.hidden);
    refresh();
    if (!panel.hidden) {
      // 面板在電腦上靠右、在手機上從底部出現，把選取的主題移到沒被擋住的地方
      const r = panel.getBoundingClientRect(), wide = r.width < innerWidth * 0.8;
      ed()?.revealSelected(wide ? r.width + 24 : 0, wide ? 0 : r.height);
    }
  }

  return { el: panel, refresh, toggle };
}
