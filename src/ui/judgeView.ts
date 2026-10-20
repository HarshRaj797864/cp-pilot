import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TestResult, effectiveTimeLimit } from '../core/judge';
import { languageFromPath } from '../core/languages';
import { Problem } from '../core/problem';
import { CompileResult, TestRunner } from '../core/runner';
import { loadProblem, saveProblem } from '../core/store';
import { CsesApi, CsesApiError, CsesSubmission, CsesUser, csesTaskId, describeSubmission, submissionUrl } from '../cses/api';
import { CsesAuth } from '../cses/auth';
import { prepareSubmitFile, shortVerdict } from '../cses/files';
import { submitAndWait } from '../cses/submitter';
import { getCsesLanguage, getLanguageCommands } from '../workspace/settings';

type ResultSlot = TestResult | 'running' | null;
type CompileState = { status: 'idle' | 'compiling' | 'ok' } | { status: 'error'; output: string };

interface SubmissionState {
  /** Undefined until CSES accepts the upload. */
  id?: number;
  outcome: 'pending' | 'accepted' | 'rejected' | 'error';
  summary: string;
  compiler?: string;
  /** Per-test verdicts from CSES, e.g. { number: 3, verdict: "WA", timeMs: 120 }. */
  tests?: { number: number; verdict: string; timeMs: number | null }[];
}

/** Results survive switching between files, until the next run of that file. */
interface FileState {
  results: ResultSlot[];
  compile: CompileState;
  submission?: SubmissionState;
}

type Message =
  | { type: 'ready' }
  | { type: 'runAll' }
  | { type: 'run'; index: number }
  | { type: 'stop' }
  | { type: 'addTest' }
  | { type: 'deleteTest'; index: number }
  | { type: 'updateTest'; index: number; input: string; output: string }
  | { type: 'submit' }
  | { type: 'cancelSubmit' }
  | { type: 'csesLogin' }
  | { type: 'csesLogout' }
  | { type: 'openSubmission'; id: number };

export class JudgeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'cpPilot.judge';

  private view: vscode.WebviewView | undefined;
  private file: string | undefined;
  private problem: Problem | undefined;
  private readonly fileStates = new Map<string, FileState>();
  private readonly runner = new TestRunner();
  private runningFile: string | undefined;
  private runId = 0;
  private readonly submitting = new Map<string, AbortController>();
  private csesUser: CsesUser | undefined;
  private readonly accepted = new vscode.EventEmitter<string>();
  /** Fires with the CSES task id when a submission is accepted. */
  readonly onDidAccept = this.accepted.event;
  private readonly disposables: vscode.Disposable[] = [this.accepted];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly csesApi: CsesApi,
    private readonly csesAuth: CsesAuth,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) => this.onEditorChanged(e)),
      csesAuth.onDidChange((user) => {
        this.csesUser = user;
        this.postState();
      }),
    );
    this.onEditorChanged(vscode.window.activeTextEditor);
    // Restore a saved login quietly; failures just mean "not logged in".
    csesAuth.currentUser().catch(() => undefined);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage(
      (m: Message) =>
        this.onMessage(m).catch((err) =>
          vscode.window.showErrorMessage(`CP Pilot: ${err instanceof Error ? err.message : String(err)}`),
        ),
      undefined,
      this.disposables,
    );
    view.onDidDispose(() => (this.view = undefined), undefined, this.disposables);
  }

  /** Re-reads the stored problem, e.g. after a new import for the active file. */
  async refresh(): Promise<void> {
    this.problem = this.file ? await loadProblem(this.file) : undefined;
    void vscode.commands.executeCommand('setContext', 'cpPilot.isCsesFile', this.csesTask() !== undefined);
    this.postState();
  }

  async submit(): Promise<void> {
    const file = this.file;
    const taskId = this.csesTask();
    const language = file && languageFromPath(file);
    if (!file || !taskId || !language) {
      vscode.window.showInformationMessage('CP Pilot: submitting works for CSES problems imported with Competitive Companion.');
      return;
    }
    if (this.submitting.has(file)) return;

    const failing = this.stateFor(file).results.filter((r) => r && r !== 'running' && r.verdict !== 'AC').length;
    if (failing > 0) {
      const choice = await vscode.window.showWarningMessage(
        `${failing} local test${failing > 1 ? 's' : ''} failed on the last run. Submit anyway?`,
        { modal: true },
        'Submit',
      );
      if (choice !== 'Submit') return;
    }

    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
    if (doc?.isDirty) await doc.save();
    const content = doc?.getText() ?? (await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString();
    if (!content.trim()) {
      vscode.window.showWarningMessage('CP Pilot: the solution file is empty.');
      return;
    }
    const upload = prepareSubmitFile(language, file, content);
    if (!upload.ok) {
      vscode.window.showWarningMessage(`CP Pilot: ${upload.reason}`);
      return;
    }

    const token = await this.csesAuth.getToken();
    if (!token) return;

    await this.reveal();
    const state = this.stateFor(file);
    let submissionId: number | undefined;
    const show = (s: SubmissionState) => this.update(file, () => (state.submission = s));
    const controller = new AbortController();
    this.submitting.set(file, controller);
    show({ outcome: 'pending', summary: 'Submitting…' });

    try {
      const final = await submitAndWait({
        api: this.csesApi,
        token,
        taskId,
        file: { name: upload.name, content: upload.content },
        language: getCsesLanguage(language),
        onUpdate: (s) => {
          submissionId = s.id;
          show(toSubmissionState(s));
        },
        signal: controller.signal,
      });
      if (final.result === 'ACCEPTED') this.accepted.fire(taskId);
      const summary = describeSubmission(final);
      const open = 'View on CSES';
      const message = `CSES #${final.id}: ${summary}`;
      const shown =
        final.result === 'ACCEPTED'
          ? vscode.window.showInformationMessage(message, open)
          : vscode.window.showWarningMessage(message, open);
      shown.then((c) => {
        if (c === open) void vscode.env.openExternal(vscode.Uri.parse(submissionUrl(final.id)));
      });
    } catch (err) {
      if (controller.signal.aborted) {
        show({
          id: submissionId,
          outcome: 'error',
          summary: submissionId ? 'Stopped waiting. CSES is still grading it.' : 'Stopped.',
        });
      } else if (err instanceof CsesApiError && err.isAuthError) {
        await this.csesAuth.invalidate();
        show({ outcome: 'error', summary: 'CSES login expired. Log in again and resubmit.' });
      } else {
        show({ outcome: 'error', summary: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      this.submitting.delete(file);
      this.postState();
    }
  }

  /** Stops following the current file's submission; CSES keeps grading it regardless. */
  cancelSubmit(): void {
    if (this.file) this.submitting.get(this.file)?.abort();
  }

  private csesTask(): string | undefined {
    return this.problem ? csesTaskId(this.problem.url) : undefined;
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
        io: problem.io,
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
      case 'submit':
        return this.submit();
      case 'cancelSubmit':
        return this.cancelSubmit();
      case 'csesLogin':
        await this.csesAuth.login();
        return;
      case 'csesLogout':
        return this.csesAuth.logout();
      case 'openSubmission':
        await vscode.env.openExternal(vscode.Uri.parse(submissionUrl(m.id)));
        return;
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
        cses: this.csesTask() && {
          user: this.csesUser ? (this.csesUser.displayname ?? this.csesUser.username) : null,
          submitting: file !== undefined && this.submitting.has(file),
          submission: state?.submission ?? null,
        },
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

function toSubmissionState(s: CsesSubmission): SubmissionState {
  const outcome = s.pending ? 'pending' : s.result === 'ACCEPTED' ? 'accepted' : 'rejected';
  return {
    id: s.id,
    outcome,
    summary: describeSubmission(s),
    compiler: s.compiler?.trim() || undefined,
    tests: s.tests?.map((t) => ({ number: t.number, verdict: shortVerdict(t.verdict), timeMs: t.time })),
  };
}
