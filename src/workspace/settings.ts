import * as vscode from 'vscode';
import { CsesLanguage } from '../cses/api';
import { LanguageCommands, defaultCommands } from '../core/languages';
import { Language, isLanguage } from '../core/naming';

export const SECTION = 'cpPilot';

export interface Settings {
  companionPort: number;
  defaultLanguage: Language;
  templateFile: string;
}

export function getSettings(): Settings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const language = config.get<string>('defaultLanguage', 'cpp');
  return {
    companionPort: config.get<number>('companionPort', 27121),
    defaultLanguage: isLanguage(language) ? language : 'cpp',
    templateFile: config.get<string>('templateFile', ''),
  };
}

/** CSES language for a submission; nulls let CSES pick from the file extension and its default version. */
export function getCsesLanguage(language: Language): CsesLanguage {
  const overrides = vscode.workspace
    .getConfiguration(SECTION)
    .get<Partial<Record<Language, Partial<CsesLanguage>>>>('cses.languages', {});
  return { name: null, option: null, ...overrides[language] };
}

/** Built-in commands for a language, with any user overrides from `cpPilot.languageCommands` applied. */
export function getLanguageCommands(language: Language): LanguageCommands {
  const overrides = vscode.workspace
    .getConfiguration(SECTION)
    .get<Partial<Record<Language, Partial<LanguageCommands>>>>('languageCommands', {});
  return { ...defaultCommands()[language], ...overrides[language] };
}
