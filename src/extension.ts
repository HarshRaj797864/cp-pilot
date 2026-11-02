import * as vscode from 'vscode';
import { AiAssistant } from './ai/assistant';
import { CPH_SUBMIT_PORT, CphSubmitQueue } from './companion/cphSubmit';
import { CompanionServer } from './companion/server';
import { CsesApi } from './cses/api';
import { CsesAuth } from './cses/auth';
import { CsesProblemsProvider } from './ui/csesTree';
import { JudgeViewProvider } from './ui/judgeView';
import { ProblemImporter } from './workspace/importer';
import { CompanionListener } from './workspace/listener';
import { SECTION } from './workspace/settings';

let server: CompanionServer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('CP Pilot', { log: true });
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusItem.command = 'cpPilot.restartListener';
  context.subscriptions.push(log, statusItem);

  const csesApi = new CsesApi();
  const csesAuth = new CsesAuth(context.secrets, csesApi);
  const cphSubmitQueue = new CphSubmitQueue();
  const assistant = new AiAssistant(context.secrets);
  const judge = new JudgeViewProvider(
    context.extensionUri,
    csesApi,
    csesAuth,
    {
      queue: cphSubmitQueue,
      // cph-submit only ever polls CPH's port.
      available: () => server?.port === CPH_SUBMIT_PORT,
    },
    assistant,
  );
  const problems = new CsesProblemsProvider(context.globalState, csesApi, csesAuth);
  const problemsView = vscode.window.createTreeView(CsesProblemsProvider.viewId, { treeDataProvider: problems });
  problems.attach(problemsView);

  const importer = new ProblemImporter(() => judge.refresh());
  // Created right after the server; the server only calls back into it once it's listening.
  let listener: CompanionListener | undefined;
  server = new CompanionServer(
    async (problem, batch) => {
      const io = problem.io ? ` (file I/O: ${problem.io.inputFile ?? 'stdin'} -> ${problem.io.outputFile ?? 'stdout'})` : '';
      const part = batch ? ` [batch ${batch.id.slice(0, 8)}, size ${batch.size}]` : ' [no batch info]';
      log.info(`Received "${problem.name}" (${problem.group}) with ${problem.tests.length} tests${io}${part}`);
      await importer.import(problem, batch);
    },
    (err) => log.error('Failed to handle problem', err),
    cphSubmitQueue,
    {
      identity: () => ({ folder: vscode.workspace.name ?? 'a window without a folder' }),
      onHandoff: () => listener?.onHandoff(),
    },
  );
  listener = new CompanionListener(server, statusItem, log, context.globalState);

  const PORT_CHANGE_DEBOUNCE_MS = 800;
  let portChangeTimer: NodeJS.Timeout | undefined;

  context.subscriptions.push(
    importer,
    csesAuth,
    judge,
    problems,
    problemsView,
    judge.onDidAccept((taskId) => problems.markSolved(taskId)),
    vscode.commands.registerCommand('cpPilot.ai.explainFailure', () => judge.ai.explain()),
    vscode.commands.registerCommand('cpPilot.ai.stressTest', () => judge.ai.stress()),
    vscode.commands.registerCommand('cpPilot.ai.setClaudeKey', () => assistant.setClaudeKey()),
    vscode.commands.registerCommand('cpPilot.ai.clearClaudeKey', () => assistant.clearClaudeKey()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cpPilot.ai.enabled')) void judge.refresh();
    }),
    vscode.commands.registerCommand('cpPilot.cses.refreshProblems', () => problems.refresh()),
    vscode.commands.registerCommand('cpPilot.cses.searchProblems', () => problems.search()),
    vscode.commands.registerCommand('cpPilot.cses.clearSearch', () => problems.clearSearch()),
    vscode.commands.registerCommand('cpPilot.cses.hideSolved', () => problems.setHideSolved(true)),
    vscode.commands.registerCommand('cpPilot.cses.showSolved', () => problems.setHideSolved(false)),
    vscode.commands.registerCommand('cpPilot.cses.openProblem', (url: string) =>
      vscode.env.openExternal(vscode.Uri.parse(url)),
    ),
    vscode.commands.registerCommand('cpPilot.submit', () => judge.submit()),
    vscode.commands.registerCommand('cpPilot.cses.login', () => csesAuth.login()),
    vscode.commands.registerCommand('cpPilot.cses.logout', () => csesAuth.logout()),
    vscode.window.registerWebviewViewProvider(JudgeViewProvider.viewId, judge, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('cpPilot.runTests', () => judge.runTests()),
    vscode.commands.registerCommand('cpPilot.stopTests', () => judge.stop()),
    // Clicking the status bar item retries, taking the port from another CP Pilot window if needed.
    vscode.commands.registerCommand('cpPilot.restartListener', () => listener!.restart({ takeOver: true })),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) listener!.onWindowFocused();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(`${SECTION}.companionPort`)) return;
      // The settings UI saves on every keystroke (2, 27, 271, ...); only act once typing settles.
      clearTimeout(portChangeTimer);
      portChangeTimer = setTimeout(() => void listener!.restart(), PORT_CHANGE_DEBOUNCE_MS);
    }),
    { dispose: () => clearTimeout(portChangeTimer) },
    { dispose: () => void server?.stop() },
  );

  // Not awaited: a port message waiting for the user must not hold up activation.
  // A window opened (and focused) now is where the user works, so it may take the port.
  void listener.restart({ takeOver: vscode.window.state.focused });
}

export async function deactivate(): Promise<void> {
  await server?.stop();
}
