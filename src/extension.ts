import * as vscode from 'vscode';
import { CompanionServer } from './companion/server';
import { CsesApi } from './cses/api';
import { CsesAuth } from './cses/auth';
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
    vscode.commands.registerCommand('cpPilot.cses.submit', () => judge.submit()),
    vscode.commands.registerCommand('cpPilot.cses.login', () => csesAuth.login()),
    vscode.commands.registerCommand('cpPilot.cses.logout', () => csesAuth.logout()),
    vscode.window.registerWebviewViewProvider(JudgeViewProvider.viewId, judge, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('cpPilot.runTests', () => judge.runTests()),
    vscode.commands.registerCommand('cpPilot.stopTests', () => judge.stop()),
    vscode.commands.registerCommand('cpPilot.restartListener', startListener),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${SECTION}.companionPort`)) startListener();
    }),
    { dispose: () => void server?.stop() },
  );

  await startListener();
}

export async function deactivate(): Promise<void> {
  await server?.stop();
}

async function startListener(): Promise<void> {
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
    if (code === 'EADDRINUSE') {
      const choice = await vscode.window.showWarningMessage(
        `CP Pilot: port ${companionPort} is already in use (CPH uses 27121). ` +
          `Pick another port and add it under "Custom ports" in Competitive Companion's settings.`,
        'Change Port',
      );
      if (choice === 'Change Port') {
        vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.companionPort`);
      }
    }
  }
}

function showStatus(text: string, tooltip: string): void {
  statusItem.text = text;
  statusItem.tooltip = tooltip;
  statusItem.show();
}
