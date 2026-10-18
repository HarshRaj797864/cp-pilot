import * as vscode from 'vscode';
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
