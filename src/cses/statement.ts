import { HttpTransport, nodeTransport } from '../core/http';

/**
 * Fetches a CSES problem statement as plain text (math stays as TeX). The API's statement endpoint
 * answers "Feature is currently unsupported", so this reads the public task page instead.
 */
export async function fetchCsesStatement(taskId: string, transport: HttpTransport = nodeTransport): Promise<string> {
  const res = await transport({
    method: 'GET',
    url: `https://cses.fi/problemset/task/${encodeURIComponent(taskId)}`,
    timeoutMs: 15_000,
  });
  if (res.status !== 200) throw new Error(`CSES returned HTTP ${res.status} for task ${taskId}`);
  const text = csesStatementText(res.text);
  if (!text) throw new Error(`Couldn't find the statement of CSES task ${taskId}`);
  return text;
}

/** The statement is the page's `<div class="md">`, which has no nested divs. */
export function csesStatementText(html: string): string | undefined {
  const start = html.indexOf('<div class="md">');
  if (start === -1) return undefined;
  const end = html.indexOf('</div>', start);
  if (end === -1) return undefined;
  return htmlToText(html.slice(start + '<div class="md">'.length, end));
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<h\d[^>]*>([\s\S]*?)<\/h\d>/gi, '\n## $1\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body: string) => `\n${body.replace(/\n+$/, '')}\n`)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}
