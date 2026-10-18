import * as path from 'node:path';
import { Language } from '../core/naming';

export type SubmitFile = { ok: true; name: string; content: string } | { ok: false; reason: string };

/** Languages CSES doesn't offer (https://cses.fi/howto/). */
const UNSUPPORTED: Partial<Record<Language, string>> = { go: 'Go' };

/**
 * Prepares the file CSES receives. CSES picks the language from the extension, and for Java
 * it requires the file name to match the class ("Invalid Java source name" otherwise).
 */
export function prepareSubmitFile(language: Language, filePath: string, content: string): SubmitFile {
  const unsupported = UNSUPPORTED[language];
  if (unsupported) return { ok: false, reason: `CSES doesn't support ${unsupported}. See cses.fi/howto for its languages.` };
  if (language === 'java') return { ok: true, name: `${javaMainClass(content)}.java`, content };
  return { ok: true, name: path.basename(filePath), content };
}

/** The class CSES should compile: the public class if there is one, else the class holding main(). */
export function javaMainClass(source: string): string {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/"(?:\\.|[^"\\])*"/g, '""');
  const publicClass = /\bpublic\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_$][\w$]*)/.exec(code);
  if (publicClass) return publicClass[1];

  const mainAt = code.search(/\bstatic\s+void\s+main\s*\(/);
  let owner: string | undefined;
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) {
    if (mainAt !== -1 && m.index! > mainAt) break;
    owner = m[1];
  }
  return owner ?? 'Main';
}

const SHORT_VERDICTS: Record<string, string> = {
  ACCEPTED: 'AC',
  'WRONG ANSWER': 'WA',
  'TIME LIMIT EXCEEDED': 'TLE',
  'RUNTIME ERROR': 'RE',
  'MEMORY LIMIT EXCEEDED': 'MLE',
  'OUTPUT LIMIT EXCEEDED': 'OLE',
};

/** "WRONG ANSWER" -> "WA"; unknown verdicts become their initials. */
export function shortVerdict(verdict: string): string {
  return (
    SHORT_VERDICTS[verdict] ??
    verdict
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
  );
}
