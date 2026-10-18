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

export function solutionFileName(problemName: string, language: Language): string {
  return `${toFileStem(problemName)}.${LANGUAGE_EXTENSIONS[language]}`;
}
