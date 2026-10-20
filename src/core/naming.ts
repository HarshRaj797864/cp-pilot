export const LANGUAGE_EXTENSIONS = {
  cpp: 'cpp',
  c: 'c',
  python: 'py',
  java: 'java',
  rust: 'rs',
  go: 'go',
  js: 'js',
} as const;

export type Language = keyof typeof LANGUAGE_EXTENSIONS;

export function isLanguage(value: string): value is Language {
  return Object.hasOwn(LANGUAGE_EXTENSIONS, value);
}

/** Turns a problem name like "A. Watermelon" into a safe file stem like "A_Watermelon". */
export function toFileStem(problemName: string): string {
  const stem = problemName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return stem || 'problem';
}

/**
 * File stem for a problem. Names in other scripts (e.g. AtCoder's "A - ファイティング・タカハシ")
 * lose most of their characters, so the task id from the URL is added to keep them distinct.
 */
export function problemFileStem(problem: { name: string; url: string }): string {
  const stem = toFileStem(problem.name);
  const lostLetters = /[^\x00-\x7F]/.test(problem.name.normalize('NFKD').replace(/[̀-ͯ]/g, ''));
  const slug = lostLetters ? urlSlug(problem.url) : undefined;
  if (!slug) return stem;
  return stem === 'problem' ? slug : `${stem}_${slug}`;
}

function urlSlug(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    const slug = last && toFileStem(last);
    return slug && slug !== 'problem' ? slug : undefined;
  } catch {
    return undefined;
  }
}

export function solutionFileName(problem: { name: string; url: string }, language: Language, copy = 1): string {
  const suffix = copy > 1 ? `_${copy}` : '';
  return `${problemFileStem(problem)}${suffix}.${LANGUAGE_EXTENSIONS[language]}`;
}
