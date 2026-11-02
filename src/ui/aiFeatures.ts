import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AiAssistant } from '../ai/assistant';
import { AiError } from '../ai/provider';
import { Diagnosis } from '../ai/schemas';
import { TestResult, Verdict } from '../core/judge';
import { languageFromPath } from '../core/languages';
import { LANGUAGE_EXTENSIONS, Language } from '../core/naming';
import { Problem, TestCase } from '../core/problem';
import { STORE_DIR } from '../core/store';
import { StressResult, stressTest } from '../core/stress';
import { getLanguageCommands } from '../workspace/settings';

export type ExplainState =
  | { status: 'loading' }
  | { status: 'done'; diagnosis: Diagnosis; by: string }
  | { status: 'error'; message: string };

export type StressState =
  | { status: 'preparing'; message: string }
  | { status: 'running'; done: number; total: number }
  | { status: 'found'; input: string; expected: string; received: string; verdict: Verdict; message?: string; added?: boolean }
  | { status: 'passed'; iterations: number }
  | { status: 'stopped'; iterations: number }
  | { status: 'error'; message: string; canOpenPrograms?: boolean };

/** What the Judge view gives the AI features: the open file and a way to change its panel state. */
export interface AiHost {
  current(): { file: string; problem: Problem; language: Language } | undefined;
  results(file: string): (TestResult | 'running' | null)[];
  /** The compiler output when the last compile failed. */
  compileError(file: string): string | undefined;
  setExplanation(file: string, index: number, state: ExplainState | undefined): void;
  setCompileExplanation(file: string, state: ExplainState | undefined): void;
  setStress(file: string, state: StressState | undefined): void;
  stressState(file: string): StressState | undefined;
  addTest(file: string, test: TestCase): Promise<void>;
  reveal(): Promise<void>;
}

const DEFAULT_ITERATIONS = 300;

export class AiFeatures {
  private readonly stressRuns = new Map<string, AbortController>();

  constructor(
    private readonly assistant: AiAssistant,
    private readonly host: AiHost,
  ) {}

  /** "Why did this fail?" for test `index`, or the compile error, or the first failing test. */
  async explain(index?: number): Promise<void> {
    const cur = this.host.current();
    if (!cur) {
      vscode.window.showInformationMessage('CP Pilot: open a solution file with tests first.');
      return;
    }
    if (index === undefined && this.host.compileError(cur.file) !== undefined) return this.explainCompile();
    const results = this.host.results(cur.file);
    const i = index ?? results.findIndex((r) => r && r !== 'running' && r.verdict !== 'AC');
    const result = results[i];
    if (i < 0 || !result || result === 'running' || result.verdict === 'AC') {
      vscode.window.showInformationMessage('CP Pilot: run the tests first; "Why?" explains a failing test.');
      return;
    }

    await this.host.reveal();
    this.host.setExplanation(cur.file, i, { status: 'loading' });
    try {
      const code = await readCode(cur.file);
      const { diagnosis, by } = await this.assistant.diagnose(cur.problem, {
        language: cur.language,
        problemName: cur.problem.name,
        code,
        test: cur.problem.tests[i],
        verdict: result.verdict,
        received: result.stdout,
        stderr: result.stderr,
        message: result.message,
      });
      this.host.setExplanation(cur.file, i, { status: 'done', diagnosis, by });
    } catch (err) {
      this.host.setExplanation(cur.file, i, { status: 'error', message: errorMessage(err) });
    }
  }

  /** Explains the last compile error in plain words. */
  async explainCompile(): Promise<void> {
    const cur = this.host.current();
    const output = cur && this.host.compileError(cur.file);
    if (!cur || output === undefined) {
      vscode.window.showInformationMessage('CP Pilot: there is no compile error to explain.');
      return;
    }
    await this.host.reveal();
    this.host.setCompileExplanation(cur.file, { status: 'loading' });
    try {
      const { diagnosis, by } = await this.assistant.explainCompileError(cur.problem, {
        language: cur.language,
        code: await readCode(cur.file),
        compilerOutput: output,
      });
      this.host.setCompileExplanation(cur.file, { status: 'done', diagnosis, by });
    } catch (err) {
      this.host.setCompileExplanation(cur.file, { status: 'error', message: errorMessage(err) });
    }
  }

  async stress(): Promise<void> {
    const cur = this.host.current();
    if (!cur) {
      vscode.window.showInformationMessage('CP Pilot: open a solution file with tests first.');
      return;
    }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('CP Pilot runs your code, so stress testing only works in a trusted workspace.');
      return;
    }
    if (cur.problem.interactive || cur.problem.io) {
      vscode.window.showInformationMessage('CP Pilot: stress testing supports stdin/stdout problems that are not interactive.');
      return;
    }
    if (this.stressRuns.has(cur.file)) return;

    const { file, problem, language } = cur;
    const ext = LANGUAGE_EXTENSIONS[language];
    const dir = path.join(path.dirname(file), STORE_DIR, 'stress', path.basename(file));
    const genFile = path.join(dir, `gen.${ext}`);
    const aiBruteFile = path.join(dir, `brute.${ext}`);

    const plan = await this.choosePlan(problem, genFile, aiBruteFile);
    if (!plan) return;

    const controller = new AbortController();
    this.stressRuns.set(file, controller);
    await this.host.reveal();
    try {
      let bruteFile = plan.bruteFile ?? aiBruteFile;
      if (plan.generate) {
        this.host.setStress(file, { status: 'preparing', message: 'Writing a test generator' + (plan.bruteFile ? '…' : ' and a brute force…') });
        await saveIfDirty(file);
        const { programs } = await this.assistant.stressPrograms(
          problem,
          { language, problemName: problem.name, statement: plan.statement, code: await readCode(file), samples: problem.tests },
          controller.signal,
        );
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(genFile, programs.generator);
        if (!plan.bruteFile) {
          if (!programs.brute) throw new AiError('The AI could not write a brute force without the statement. Paste the statement, or use your own brute-force file.');
          await fs.writeFile(aiBruteFile, programs.brute);
        }
      }
      bruteFile = plan.bruteFile ?? aiBruteFile;
      const bruteLanguage = languageFromPath(bruteFile);
      if (!bruteLanguage) throw new AiError(`CP Pilot doesn't know how to run ${path.basename(bruteFile)}.`);

      await saveIfDirty(file);
      const total = vscode.workspace.getConfiguration('cpPilot.ai').get<number>('stressIterations', DEFAULT_ITERATIONS);
      this.host.setStress(file, { status: 'running', done: 0, total });
      let lastPaint = 0;
      const result = await stressTest({
        solution: { file, commands: getLanguageCommands(language) },
        brute: { file: bruteFile, commands: getLanguageCommands(bruteLanguage) },
        generator: { file: genFile, commands: getLanguageCommands(language) },
        timeLimitMs: problem.timeLimit,
        iterations: total,
        // Random start so re-runs explore new tests.
        firstSeed: 1 + Math.floor(Math.random() * 1_000_000),
        signal: controller.signal,
        onProgress: (done) => {
          if (Date.now() - lastPaint < 100 && done < total) return;
          lastPaint = Date.now();
          this.host.setStress(file, { status: 'running', done, total });
        },
      });
      this.host.setStress(file, toStressState(result));
    } catch (err) {
      this.host.setStress(file, controller.signal.aborted ? { status: 'stopped', iterations: 0 } : { status: 'error', message: errorMessage(err) });
    } finally {
      this.stressRuns.delete(file);
    }
  }

  stopStress(): void {
    const cur = this.host.current();
    if (cur) this.stressRuns.get(cur.file)?.abort();
  }

  async addCounterexample(): Promise<void> {
    const cur = this.host.current();
    if (!cur) return;
    const state = this.host.stressState(cur.file);
    if (state?.status !== 'found' || state.added) return;
    await this.host.addTest(cur.file, { input: state.input, output: state.expected });
    this.host.setStress(cur.file, { ...state, added: true });
  }

  async openStressPrograms(): Promise<void> {
    const cur = this.host.current();
    if (!cur) return;
    const dir = path.join(path.dirname(cur.file), STORE_DIR, 'stress', path.basename(cur.file));
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) await vscode.window.showTextDocument(vscode.Uri.file(path.join(dir, f)), { preview: false, preserveFocus: true });
  }

  /** Opens the line an explanation points at in the solution's editor. */
  async revealLine(line: number): Promise<void> {
    const cur = this.host.current();
    if (!cur) return;
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(cur.file), { preview: false });
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  /** Decides where the generator and brute force come from. Undefined if the user backs out. */
  private async choosePlan(
    problem: Problem,
    genFile: string,
    aiBruteFile: string,
  ): Promise<{ generate: boolean; statement?: string; bruteFile?: string } | undefined> {
    type Pick = vscode.QuickPickItem & { id: 'rerun' | 'ai' | 'paste' | 'own' };
    const haveAiPrograms = (await exists(genFile)) && (await exists(aiBruteFile));
    const statement = await this.assistant.statementFor(problem);

    const items: Pick[] = [];
    if (haveAiPrograms) items.push({ id: 'rerun', label: '$(debug-rerun) Run again', description: 'same generator and brute force, new random tests' });
    if (statement) {
      items.push({ id: 'ai', label: '$(sparkle) Let AI write a generator and a brute force', description: 'using the CSES statement' });
    } else {
      items.push({ id: 'paste', label: '$(sparkle) Paste the statement', description: 'AI writes a generator and a brute force' });
    }
    items.push({ id: 'own', label: '$(file-code) Use my own brute-force file', description: 'AI writes only the generator' });

    const pick = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { title: 'Stress test', placeHolder: 'Where should the slow, correct reference solution come from?' });
    if (!pick) return undefined;
    switch (pick.id) {
      case 'rerun':
        return { generate: false };
      case 'ai':
        return { generate: true, statement };
      case 'paste': {
        const pasted = await vscode.window.showInputBox({
          title: 'Problem statement',
          prompt: 'Paste the full statement (input/output format and constraints matter most). Line breaks are fine to lose.',
          ignoreFocusOut: true,
        });
        return pasted?.trim() ? { generate: true, statement: pasted } : undefined;
      }
      case 'own': {
        const picked = await vscode.window.showOpenDialog({ title: 'Choose your brute-force solution', canSelectMany: false, openLabel: 'Use as brute force' });
        const bruteFile = picked?.[0]?.fsPath;
        if (!bruteFile) return undefined;
        // Reuse an earlier AI generator when there is one.
        return { generate: !(await exists(genFile)), statement, bruteFile };
      }
    }
  }

}

function toStressState(r: StressResult): StressState {
  switch (r.kind) {
    case 'found':
      return { status: 'found', input: r.input, expected: r.expected, received: r.received, verdict: r.verdict, message: r.message };
    case 'passed':
      return { status: 'passed', iterations: r.iterations };
    case 'stopped':
      return { status: 'stopped', iterations: r.iterations };
    case 'broken': {
      const who = r.program === 'solution' ? 'Your solution' : `The ${r.program === 'brute' ? 'brute force' : 'generator'}`;
      return { status: 'error', message: `${who} failed. ${r.message}`, canOpenPrograms: r.program !== 'solution' };
    }
  }
}

async function saveIfDirty(file: string): Promise<void> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
  if (doc?.isDirty) await doc.save();
}

async function readCode(file: string): Promise<string> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
  return doc?.getText() ?? (await fs.readFile(file, 'utf8'));
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof AiError) return err.message;
  if (err instanceof Error && err.name === 'AbortError') return 'Stopped.';
  return err instanceof Error ? err.message : String(err);
}
