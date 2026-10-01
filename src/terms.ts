import type { TermInfo } from './types';

const WIKI = 'https://zh.wikipedia.org';

export interface Choice { title: string; snippet: string }

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

async function wikiSummary(title: string): Promise<any | null> {
  const r = await fetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {
    headers: { 'Accept-Language': 'zh-TW' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function toInfo(s: any): TermInfo {
  const info: TermInfo = {
    title: stripTags(s.titles?.display || s.title),
    extract: s.extract,
    url: s.content_urls?.desktop?.page || `${WIKI}/wiki/${encodeURIComponent(s.title)}`,
  };
  if (s.thumbnail?.source) info.thumb = s.thumbnail.source;
  return info;
}

/**
 * 查一個名詞。查得到唯一條目就回傳解釋；
 * 是消歧義頁或查無條目時，回傳候選清單讓使用者選。
 */
export async function lookupTerm(term: string, forceChoose = false): Promise<{ info: TermInfo } | { choices: Choice[] }> {
  const s = forceChoose ? null : await wikiSummary(term);
  if (s && s.type === 'standard' && s.extract) return { info: toInfo(s) };
  const q = await fetch(`${WIKI}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=6&format=json&origin=*`)
    .then(r => r.json());
  const choices: Choice[] = (q.query?.search || [])
    .filter((x: any) => !/消歧義|消歧义/.test(x.snippet) && x.title !== s?.title)
    .map((x: any) => ({ title: x.title, snippet: stripTags(x.snippet) }));
  if (!choices.length) throw new Error('維基百科查不到這個詞。');
  return { choices };
}

export async function fetchTerm(title: string): Promise<TermInfo> {
  const s = await wikiSummary(title);
  if (!s?.extract) throw new Error('這個條目沒有摘要。');
  return toInfo(s);
}
