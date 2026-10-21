import * as vscode from 'vscode';
import { CODEFORCES_LANGUAGE_IDS } from '../companion/cphSubmit';
import { CsesLanguage } from '../cses/api';
import { LanguageCommands, defaultCommands } from '../core/languages';
import { Language, isLanguage } from '../core/naming';

export const SECTION = 'cpPilot';

export interface Settings {
  companionPort: number;
  defaultLanguage: Language;
  templateFile: string;
  /** For contest imports: open a tab per problem, or just the first one. */
  openContestProblems: 'all' | 'first';
}

export function getSettings(): Settings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const language = config.get<string>('defaultLanguage', 'cpp');
  return {
    companionPort: config.get<number>('companionPort', 27121),
    defaultLanguage: isLanguage(language) ? language : 'cpp',
    templateFile: config.get<string>('templateFile', ''),
    openContestProblems: config.get<string>('openContestProblems', 'all') === 'first' ? 'first' : 'all',
  };
}

/** CSES language for a submission; nulls let CSES pick from the file extension and its default version. */
export function getCsesLanguage(language: Language): CsesLanguage {
  const overrides = vscode.workspace
    .getConfiguration(SECTION)
    .get<Partial<Record<Language, Partial<CsesLanguage>>>>('cses.languages', {});
  return { name: null, option: null, ...overrides[language] };
}

/** Codeforces compiler id sent to cph-submit, from `cpPilot.codeforces.languageIds` or CPH's defaults. */
export function getCodeforcesLanguageId(language: Language): number {
  const overrides = vscode.workspace
    .getConfiguration(SECTION)
    .get<Partial<Record<Language, number>>>('codeforces.languageIds', {});
  return overrides[language] ?? CODEFORCES_LANGUAGE_IDS[language];
}

/** Built-in commands for a language, with any user overrides from `cpPilot.languageCommands` applied. */
export function getLanguageCommands(language: Language): LanguageCommands {
  const overrides = vscode.workspace
    .getConfiguration(SECTION)
    .get<Partial<Record<Language, Partial<LanguageCommands>>>>('languageCommands', {});
  return { ...defaultCommands()[language], ...overrides[language] };
}
