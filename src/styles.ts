import type { FontKey, NodeStyle } from './types';

/** 各平台都找得到替代字體的字體組合 */
export const FONTS: Record<FontKey, { label: string; stack: string }> = {
  sans: { label: '黑體', stack: '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif' },
  serif: { label: '明體', stack: '"Songti TC", "Noto Serif TC", "PMingLiU", serif' },
  kai: { label: '楷體', stack: '"Kaiti TC", "BiauKai", "DFKai-SB", "KaiTi", serif' },
  round: { label: '圓體', stack: '"Yuanti TC", "jf-openhuninn", "Microsoft JhengHei", sans-serif' },
  mono: { label: '等寬', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
};

export const MIN_W = 40, MIN_H = 28;

/** 把自訂樣式套到主題框上（CSS 變數沒設定時用預設值） */
export function applyNodeStyle(el: HTMLElement, s: NodeStyle | undefined) {
  const set = (k: string, v: string | undefined) => (v ? el.style.setProperty(k, v) : el.style.removeProperty(k));
  set('--fill', s?.fill);
  set('--bd', s?.border);
  set('--fg', s?.color);
  set('--ff', s?.font && FONTS[s.font]?.stack);
  set('--fs', s?.size ? s.size + 'px' : undefined);
  set('--fw', s?.bold === undefined ? undefined : s.bold ? '700' : '400');
  el.style.width = s?.w ? s.w + 'px' : '';
  el.style.maxWidth = s?.w ? 'none' : '';
  el.style.minHeight = s?.h ? s.h + 'px' : '';
  el.dataset.align = s?.align || 'center';
  el.dataset.valign = s?.valign || 'middle';
}
