import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { placeSolution } from '../core/placement';
import { Batch, Problem } from '../core/problem';
import { getSettings } from './settings';

/** How long to wait for the rest of a contest before reporting what arrived. */
const BATCH_SETTLE_MS = 3000;

interface PendingBatch {
  size: number;
  group: string;
  files: { name: string; path: string }[];
  timer?: NodeJS.Timeout;
}

/** Imports problems from Competitive Companion. A whole contest opens its first problem, not one tab each. */
export class ProblemImporter {
  private readonly batches = new Map<string, PendingBatch>();

  constructor(private readonly onImported: () => void | Promise<void>) {}

  async import(problem: Problem, batch?: Batch): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage(
        `CP Pilot received "${problem.name}" but no folder is open. Open a folder and send it again.`,
      );
      return;
    }

    const { defaultLanguage, templateFile } = getSettings();
    const placed = await placeSolution(folder.uri.fsPath, problem, defaultLanguage, await readTemplate(templateFile));

    if (!batch || batch.size <= 1) {
      await openFile(placed.path);
      vscode.window.setStatusBarMessage(`CP Pilot: imported "${problem.name}" (${problem.tests.length} tests)`, 5000);
      await this.onImported();
      return;
    }
    this.addToBatch(batch, problem, placed.path);
  }

  dispose(): void {
    for (const pending of this.batches.values()) clearTimeout(pending.timer);
    this.batches.clear();
  }

  private addToBatch(batch: Batch, problem: Problem, file: string): void {
    let pending = this.batches.get(batch.id);
    if (!pending) {
      pending = { size: batch.size, group: problem.group, files: [] };
      this.batches.set(batch.id, pending);
    }
    pending.files.push({ name: problem.name, path: file });
    clearTimeout(pending.timer);
    // Finish once everything arrived, or after a pause if some problems never come.
    const delay = pending.files.length >= pending.size ? 0 : BATCH_SETTLE_MS;
    pending.timer = setTimeout(() => void this.finishBatch(batch.id), delay);
  }

  private async finishBatch(id: string): Promise<void> {
    const pending = this.batches.get(id);
    if (!pending) return;
    this.batches.delete(id);

    const files = [...pending.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    await openFile(files[0].path);
    await this.onImported();

    const missing = pending.size - files.length;
    const where = pending.group ? ` from ${pending.group}` : '';
    const message =
      `CP Pilot: imported ${files.length} problems${where}.` +
      (missing > 0 ? ` ${missing} didn't arrive; send them again from the browser.` : '');
    const choice = await vscode.window.showInformationMessage(message, 'Open All');
    if (choice === 'Open All') {
      for (const f of files) await openFile(f.path);
    }
  }
}

async function openFile(file: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function readTemplate(templateFile: string): Promise<string> {
  if (!templateFile) return '';
  try {
    return await fs.readFile(path.resolve(templateFile), 'utf8');
  } catch {
    vscode.window.showWarningMessage(`CP Pilot: couldn't read template file ${templateFile}`);
    return '';
  }
}
