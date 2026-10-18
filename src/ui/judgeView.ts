import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TestResult, effectiveTimeLimit } from '../core/judge';
import { languageFromPath } from '../core/languages';
import { Problem } from '../core/problem';
import { CompileResult, TestRunner } from '../core/runner';
import { loadProblem, saveProblem } from '../core/store';
import { getLanguageCommands } from '../workspace/settings';

type ResultSlot = TestResult | 'running' | null;
type CompileState = { status: 'idle' | 'compiling' | 'ok' } | { status: 'error'; output: string };

/** Results survive switching between files, until the next run of that file. */
interface FileState {
  results: ResultSlot[];
  compile: CompileState;
}

type Message =
  | { type: 'ready' }
  | { type: 'runAll' }
  | { type: 'run'; index: number }
  | { type: 'stop' }
  | { type: 'addTest' }
  | { type: 'deleteTest'; index: number }
  | { type: 'updateTest'; index: number; input: string; output: string };

export class JudgeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'cpPilot.judge';

  private view: vscode.WebviewView | undefined;
  private file: string | undefined;
  private problem: Problem | undefined;
  private readonly fileStates = new Map<string, FileState>();
  private readonly runner = new TestRunner();
  private runningFile: string | undefined;
  private runId = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor((e) => this.onEditorChanged(e)));
    this.onEditorChanged(vscode.window.activeTextEditor);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((m: Message) => this.onMessage(m), undefined, this.disposables);
    view.onDidDispose(() => (this.view = undefined), undefined, this.disposables);
  }

  /** Re-reads the stored problem, e.g. after a new import for the active file. */
  async refresh(): Promise<void> {
    this.problem = this.file ? await loadProblem(this.file) : undefined;
    this.postState();
  }

  async runTests(indices?: number[]): Promise<void> {
    const file = this.file;
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('CP Pilot runs your code, so it only works in a trusted workspace.');
      return;
    }
    if (!file) {
      vscode.window.showInformationMessage('CP Pilot: open a solution file to run its tests.');
      return;
    }
    const language = languageFromPath(file);
    const problem = this.problem;
    if (!language || !problem || problem.tests.length === 0) {
      vscode.window.showInformationMessage('CP Pilot: no tests for this file yet. Import the problem or add a test.');
      return;
    }
    if (problem.interactive) {
      vscode.window.showWarningMessage('CP Pilot: interactive problems can’t be judged locally yet.');
      return;
    }

    await this.reveal();
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
    if (doc?.isDirty) await doc.save();

    const state = this.stateFor(file);
    const targets = indices ?? problem.tests.map((_, i) => i);
    state.results.length = problem.tests.length;
    for (const i of targets) state.results[i] = null;
    this.runningFile = file;
    const runId = ++this.runId;
    this.postState();

    try {
      await this.runner.run({
        file,
        tests: problem.tests,
        indices: targets,
        timeLimitMs: problem.timeLimit,
        commands: getLanguageCommands(language),
        onCompileStart: () => this.update(file, () => (state.compile = { status: 'compiling' })),
        onCompileEnd: (r: CompileResult) =>
          this.update(file, () => (state.compile = r.ok ? { status: 'ok' } : { status: 'error', output: r.output })),
        onTestStart: (i) => this.update(file, () => (state.results[i] = 'running')),
        onTestEnd: (i, r) => this.update(file, () => (state.results[i] = r)),
      });
    } finally {
      // A newer run superseded this one; leave its state alone.
      if (runId === this.runId) {
        // Clear any "running" markers left by a cancelled run.
        state.results = state.results.map((r) => (r === 'running' ? null : r));
        if (state.compile.status === 'compiling') state.compile = { status: 'idle' };
        this.runningFile = undefined;
        this.postState();
      }
    }
  }

  stop(): void {
    this.runner.stop();
  }

  dispose(): void {
    this.runner.stop();
    this.disposables.forEach((d) => d.dispose());
  }

  private async reveal(): Promise<void> {
    if (this.view) this.view.show(true);
    else await vscode.commands.executeCommand(`${JudgeViewProvider.viewId}.focus`);
  }

  private async onEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {
    // Focus moving to the panel or a non-file editor keeps the current file.
    if (!editor || editor.document.uri.scheme !== 'file') return;
    const file = editor.document.uri.fsPath;
    if (!languageFromPath(file) || file === this.file) return;
    this.file = file;
    await this.refresh();
  }

  private async onMessage(m: Message): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.postState();
        return;
      case 'runAll':
        return this.runTests();
      case 'run':
        return this.runTests([m.index]);
      case 'stop':
        return this.stop();
      case 'addTest':
        return this.editTests((tests) => tests.push({ input: '', output: '' }));
      case 'deleteTest':
        return this.editTests((tests, results) => {
          tests.splice(m.index, 1);
          results.splice(m.index, 1);
        });
      case 'updateTest':
        return this.editTests((tests, results) => {
          tests[m.index] = { input: m.input, output: m.output };
          results[m.index] = null;
        });
    }
  }

  private async editTests(edit: (tests: Problem['tests'], results: ResultSlot[]) => void): Promise<void> {
    const file = this.file;
    if (!file) return;
    if (this.runningFile === file) this.stop();
    // Files without an imported problem get one on their first hand-written test.
    const problem = this.problem ?? {
      name: path.basename(file, path.extname(file)),
      group: '',
      url: '',
      interactive: false,
      timeLimit: 0,
      memoryLimit: 0,
      tests: [],
    };
    edit(problem.tests, this.stateFor(file).results);
    this.problem = problem;
    await saveProblem(file, problem);
    this.postState();
  }

  private stateFor(file: string): FileState {
    let state = this.fileStates.get(file);
    if (!state) {
      state = { results: [], compile: { status: 'idle' } };
      this.fileStates.set(file, state);
    }
    return state;
  }

  /** Applies a state change for a file and re-renders only if that file is on screen. */
  private update(file: string, change: () => void): void {
    change();
    if (file === this.file) this.postState();
  }

  private postState(): void {
    if (!this.view) return;
    const file = this.file;
    const state = file ? this.stateFor(file) : undefined;
    const problem = this.problem;
    void this.view.webview.postMessage({
      type: 'state',
      state: {
        file: file ? path.basename(file) : null,
        problem: problem && {
          name: problem.name,
          url: problem.url,
          timeLimit: effectiveTimeLimit(problem.timeLimit),
          interactive: problem.interactive,
        },
        tests: problem?.tests ?? [],
        results: problem?.tests.map((_, i) => state?.results[i] ?? null) ?? [],
        compile: state?.compile ?? { status: 'idle' },
        running: file !== undefined && this.runningFile === file,
      },
    });
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'judge.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'judge.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${css}" rel="stylesheet">
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
