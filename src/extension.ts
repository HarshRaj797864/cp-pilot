import * as vscode from 'vscode';
import { CompanionServer } from './companion/server';
import { CsesApi } from './cses/api';
import { CsesAuth } from './cses/auth';
import { CsesProblemsProvider } from './ui/csesTree';
import { JudgeViewProvider } from './ui/judgeView';
import { importProblem } from './workspace/importer';
import { SECTION, getSettings } from './workspace/settings';

let server: CompanionServer | undefined;
let statusItem: vscode.StatusBarItem;
let log: vscode.LogOutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log = vscode.window.createOutputChannel('CP Pilot', { log: true });
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusItem.command = 'cpPilot.restartListener';
  context.subscriptions.push(log, statusItem);

  const csesApi = new CsesApi();
  const csesAuth = new CsesAuth(context.secrets, csesApi);
  const judge = new JudgeViewProvider(context.extensionUri, csesApi, csesAuth);
  const problems = new CsesProblemsProvider(context.globalState, csesApi, csesAuth);
  const problemsView = vscode.window.createTreeView(CsesProblemsProvider.viewId, { treeDataProvider: problems });
  problems.attach(problemsView);

  server = new CompanionServer(
    async (problem) => {
      log.info(`Received "${problem.name}" (${problem.group}) with ${problem.tests.length} tests`);
      await importProblem(problem);
      await judge.refresh();
    },
    (err) => log.error('Failed to handle problem', err),
  );

  context.subscriptions.push(
    csesAuth,
    judge,
    problems,
    problemsView,
    judge.onDidAccept((taskId) => problems.markSolved(taskId)),
    vscode.commands.registerCommand('cpPilot.cses.refreshProblems', () => problems.refresh()),
    vscode.commands.registerCommand('cpPilot.cses.searchProblems', () => problems.search()),
    vscode.commands.registerCommand('cpPilot.cses.clearSearch', () => problems.clearSearch()),
    vscode.commands.registerCommand('cpPilot.cses.hideSolved', () => problems.setHideSolved(true)),
    vscode.commands.registerCommand('cpPilot.cses.showSolved', () => problems.setHideSolved(false)),
    vscode.commands.registerCommand('cpPilot.cses.openProblem', (url: string) =>
      vscode.env.openExternal(vscode.Uri.parse(url)),
    ),
    vscode.commands.registerCommand('cpPilot.cses.submit', () => judge.submit()),
    vscode.commands.registerCommand('cpPilot.cses.login', () => csesAuth.login()),
    vscode.commands.registerCommand('cpPilot.cses.logout', () => csesAuth.logout()),
    vscode.window.registerWebviewViewProvider(JudgeViewProvider.viewId, judge, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('cpPilot.runTests', () => judge.runTests()),
    vscode.commands.registerCommand('cpPilot.stopTests', () => judge.stop()),
    vscode.commands.registerCommand('cpPilot.restartListener', () => startListener()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(`${SECTION}.companionPort`)) return;
      // The settings UI saves on every keystroke (2, 27, 271, ...); only act once typing settles.
      clearTimeout(portChangeTimer);
      portChangeTimer = setTimeout(() => void startListener(), PORT_CHANGE_DEBOUNCE_MS);
    }),
    { dispose: () => clearTimeout(portChangeTimer) },
    { dispose: () => void server?.stop() },
  );

  // Not awaited: a port warning waiting for the user must not hold up activation.
  void startListener();
}

export async function deactivate(): Promise<void> {
  await server?.stop();
}

const PORT_CHANGE_DEBOUNCE_MS = 800;
let portChangeTimer: NodeJS.Timeout | undefined;
let listenerQueue: Promise<void> = Promise.resolve();

/** Restarts are queued so two can never interleave and leave a stale status or a leaked socket. */
function startListener(): Promise<void> {
  listenerQueue = listenerQueue.then(restartListener);
  return listenerQueue;
}

async function restartListener(): Promise<void> {
  if (!server) return;
  await server.stop();
  const { companionPort } = getSettings();
  try {
    const port = await server.start(companionPort);
    log.info(`Listening for Competitive Companion on port ${port}`);
    showStatus(`$(radio-tower) CP Pilot :${port}`, `Listening for Competitive Companion on port ${port}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    log.error(`Could not listen on port ${companionPort}`, err);
    showStatus(`$(warning) CP Pilot`, `Not listening (port ${companionPort} unavailable). Click to retry.`);
    const reason =
      code === 'EADDRINUSE'
        ? `port ${companionPort} is already in use (CPH uses 27121). Pick another port and add it under "Custom ports" in Competitive Companion's settings.`
        : code === 'EACCES'
          ? `port ${companionPort} needs admin rights. Pick a port above 1024.`
          : `couldn't listen on port ${companionPort} (${code ?? String(err)}).`;
    // Shown without awaiting so the restart queue isn't blocked on the user.
    void vscode.window.showWarningMessage(`CP Pilot: ${reason}`, 'Change Port').then((choice) => {
      if (choice === 'Change Port') {
        void vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.companionPort`);
      }
    });
  }
}

function showStatus(text: string, tooltip: string): void {
  statusItem.text = text;
  statusItem.tooltip = tooltip;
  statusItem.show();
}
