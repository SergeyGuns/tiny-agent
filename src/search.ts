import { FETCH_TIMEOUT_MS } from './config.js';
import { DdgResult } from './html.js';

// ─── Translation (MyMemory, free, no key) ──────────────────────

export async function translateRuToEn(text: string): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data?.responseData?.translatedText) return data.responseData.translatedText;
    }
  } catch { /* translation failed — use original */ }
  return text;
}

// ─── Wikipedia search (replaces DuckDuckGo HTML scraping) ──────

export async function searchDuckDuckGo(query: string, numResults: number): Promise<DdgResult[]> {
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(query);
  const translatedQuery = hasCyrillic ? await translateRuToEn(query) : query;

  const enQuery = translatedQuery
    .replace(/различия между/gi, 'differences between')
    .replace(/преимущества/gi, 'advantages').replace(/недостатки/gi, 'disadvantages')
    .replace(/сравнение/gi, 'comparison').replace(/столица/gi, 'capital')
    .replace(/население/gi, 'population').replace(/страны/gi, 'countries')
    .replace(/лучшие практики/gi, 'best practices').replace(/работа с/gi, 'working with')
    .replace(/последний релиз/gi, 'latest release').replace(/версия/gi, 'version')
    .replace(/дата/gi, 'date').replace(/текущий/gi, 'current')
    .replace(/информация/gi, 'information').replace(/найти/gi, 'find')
    .replace(/список/gi, 'list').replace(/топ/gi, 'top');

  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(enQuery)}&format=json&srlimit=${numResults}&origin=*`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TinyAgent/10 (github.com/SergeyGuns/tiny-agent)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = await res.json() as any;
      return (data?.query?.search || []).slice(0, numResults).map((x: any) => ({
        title: (x.title as string).replace(/<[^>]+>/g, ''),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((x.title as string).replace(/ /g, '_'))}`,
        snippet: (x.snippet as string).replace(/<[^>]+>/g, '').substring(0, 250),
      }));
    }
  } catch { /* Wikipedia unavailable — return empty */ }
  return [];
}
