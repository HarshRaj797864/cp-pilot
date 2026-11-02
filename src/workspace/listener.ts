import * as vscode from 'vscode';
import { PortOwner, findFreePort, requestHandoff, whoHasPort } from '../companion/portOwner';
import { CompanionServer } from '../companion/server';
import { SECTION, getSettings } from './settings';

const DISMISSED_KEY = 'cpPilot.portWarning.dismissed';
const SUGGESTED_PORT = 27150;

type ListenerState = 'listening' | 'otherWindow' | 'blocked';

/**
 * Keeps the Competitive Companion listener running and explains, without nagging, when it can't.
 * Several VS Code windows can run CP Pilot but only one can hold the port: that's normal, so it only
 * shows in the status bar, and the port moves to whichever window (with a folder) you switch to.
 * Another program on the port gets one clear, actionable message per session.
 */
export class CompanionListener {
  private state: ListenerState = 'blocked';
  private queue: Promise<void> = Promise.resolve();
  private warnedThisSession = false;

  constructor(
    private readonly server: CompanionServer,
    private readonly status: vscode.StatusBarItem,
    private readonly log: vscode.LogOutputChannel,
    private readonly memento: vscode.Memento,
  ) {}

  /** Restarts are queued so two never interleave. `takeOver` asks another CP Pilot window for the port. */
  restart(opts: { takeOver?: boolean } = {}): Promise<void> {
    this.queue = this.queue.then(() => this.doRestart(opts.takeOver ?? false)).catch((err) => this.log.error('Listener restart failed', err));
    return this.queue;
  }

  /** Switching to this window brings Competitive Companion's problems here. */
  onWindowFocused(): void {
    if (this.state === 'otherWindow' && hasFolder()) void this.restart({ takeOver: true });
  }

  /** Another window took the port (the server has already stopped). */
  onHandoff(): void {
    this.state = 'otherWindow';
    this.log.info('Another CP Pilot window took over the port');
    this.show('$(debug-pause) CP Pilot', 'Another VS Code window is receiving problems now. Switch back to this window, or click here, to receive them here.');
  }

  private async doRestart(takeOver: boolean): Promise<void> {
    await this.server.stop();
    const port = getSettings().companionPort;
    const failure = await this.tryStart(port);
    if (!failure) return;

    if (failure !== 'EADDRINUSE') {
      this.state = 'blocked';
      const why = failure === 'EACCES' ? 'needs administrator rights; use a port above 1024' : `couldn't be opened (${failure})`;
      this.show('$(warning) CP Pilot', `Not receiving problems: port ${port} ${why}. Click to retry.`);
      void vscode.window.showWarningMessage(`CP Pilot: port ${port} ${why}.`, 'Change Port').then((choice) => {
        if (choice) void vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.companionPort`);
      });
      return;
    }

    let owner = await whoHasPort(port);
    if (owner.kind === 'cp-pilot' && takeOver && hasFolder() && (await requestHandoff(port))) {
      // Give the other window a moment to close its socket.
      for (let attempt = 0; attempt < 5; attempt++) {
        await delay(150);
        if (!(await this.tryStart(port))) {
          this.log.info(`Took over port ${port} from another CP Pilot window`);
          return;
        }
      }
      owner = await whoHasPort(port);
    }
    if (owner.kind === 'free' && !(await this.tryStart(port))) return; // the holder just went away

    if (owner.kind === 'cp-pilot') {
      this.state = 'otherWindow';
      const where = owner.folder ? `the CP Pilot window for “${owner.folder}”` : 'another CP Pilot window (an older version: update it, or close that window, to move problems here)';
      this.show('$(radio-tower) CP Pilot · other window', `Problems from Competitive Companion go to ${where}. Switch to this window or click here to receive them here.`);
      return;
    }

    this.state = 'blocked';
    const who = describe(owner);
    this.show('$(warning) CP Pilot', `Not receiving problems: ${who} is using port ${port}. Click to retry.`);
    this.log.warn(`Port ${port} is used by ${who}`);
    void this.warnConflict(port, owner);
  }

  /** Undefined when listening; otherwise the error code. */
  private async tryStart(port: number): Promise<string | undefined> {
    try {
      await this.server.start(port);
    } catch (err) {
      return (err as NodeJS.ErrnoException).code ?? String(err);
    }
    this.state = 'listening';
    this.log.info(`Listening for Competitive Companion on port ${port}`);
    this.show(`$(radio-tower) CP Pilot :${port}`, `Receiving problems from Competitive Companion on port ${port}.`);
    return undefined;
  }

  /** One clear message per session, with the fix one click away. */
  private async warnConflict(port: number, owner: PortOwner): Promise<void> {
    if (this.warnedThisSession || this.memento.get<boolean>(DISMISSED_KEY)) return;
    this.warnedThisSession = true;

    const free = await findFreePort(port === SUGGESTED_PORT ? SUGGESTED_PORT + 1 : SUGGESTED_PORT);
    const move = free ? `Move to Port ${free}` : 'Change Port';
    const fix = owner.kind === 'cph' ? 'Disable CPH, or move CP Pilot to another port.' : 'Move CP Pilot to another port.';
    const choice = await vscode.window.showWarningMessage(
      `CP Pilot isn't receiving problems from Competitive Companion: ${describe(owner)} is using port ${port}. ${fix}`,
      move,
      "Don't Show Again",
    );
    if (choice === "Don't Show Again") {
      await this.memento.update(DISMISSED_KEY, true);
    } else if (choice === move && free) {
      // The configuration watcher restarts the listener on the new port.
      await vscode.workspace.getConfiguration(SECTION).update('companionPort', free, vscode.ConfigurationTarget.Global);
      const copy = `Copy ${free}`;
      const next = await vscode.window.showInformationMessage(
        `CP Pilot now uses port ${free}. One step left: in your browser, open Competitive Companion's options and add ${free} under "Custom ports".`,
        copy,
      );
      if (next === copy) await vscode.env.clipboard.writeText(String(free));
    } else if (choice === move) {
      void vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.companionPort`);
    }
  }

  private show(text: string, tooltip: string): void {
    this.status.text = text;
    this.status.tooltip = tooltip;
    this.status.show();
  }
}

function describe(owner: PortOwner): string {
  return owner.kind === 'cph' ? 'CPH (Competitive Programming Helper)' : 'another program';
}

function hasFolder(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
