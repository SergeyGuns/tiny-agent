// ─── HTML text extraction ──────────────────────────────────────

export function extractTextFromHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// ─── DuckDuckGo HTML parser ───────────────────────────────────

export interface DdgResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parses DuckDuckGo HTML response into structured results.
 * Expected format: <table><tr><td><a class="result__a">title</a>...
 * <td class="result__snippet">snippet</td>...<td><a>url</a></td></tr></table>
 * The link href contains the real URL via uddg= parameter.
 */
export function parseDdgHtml(html: string, maxResults: number): DdgResult[] {
  const results: DdgResult[] = [];
  const seen = new Set<string>();

  // result__a links (contain uddg= redirect URLs)
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRe.exec(html)) !== null) {
    if (results.length >= maxResults) break;

    let url = linkMatch[1].trim();
    const title = extractTextFromHtml(linkMatch[2]);

    // DuckDuckGo wraps real URL in uddg= parameter
    if (url.includes('duckduckgo.com') && url.includes('uddg=')) {
      const m = url.match(/uddg=([^&]+)/);
      if (m) url = decodeURIComponent(m[1]);
    }
    if (url.includes('duckduckgo.com') || seen.has(url) || url.startsWith('javascript:')) continue;
    seen.add(url);

    // Extract snippet from the same row (result__snippet)
    const after = html.slice(
      linkMatch.index + linkMatch[0].length,
      linkMatch.index + linkMatch[0].length + 2000,
    );
    const snippetRe = /<(?:td|div|a|p)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div|a|p)>/i;
    const snipMatch = after.match(snippetRe);
    const snippet = snipMatch ? extractTextFromHtml(snipMatch[1]) : '';

    // Extract display URL (result__url)
    const urlRe = /<(?:span|a)[^>]*class="[^"]*result__url[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a)>/i;
    const urlMatch = after.match(urlRe);
    const displayUrl = urlMatch ? extractTextFromHtml(urlMatch[1]) : url;

    results.push({ title: title || displayUrl, url, snippet });
  }

  // Fallback: grab any external links if result__a parsing found nothing
  if (results.length === 0) {
    const fallbackRe = /<a[^>]*href="(https?:\/\/[^"]{10,})"[^>]*>([^<]{10,200})<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = fallbackRe.exec(html)) !== null) {
      if (results.length >= maxResults) break;
      const url = m[1];
      const title = m[2].trim();
      if (url.includes('duckduckgo.com') || seen.has(url)) continue;
      seen.add(url);
      results.push({ title, url, snippet: '' });
    }
  }

  return results;
}
