import * as vscode from 'vscode';
import { CsesApi, CsesUser } from './api';

const TOKEN_KEY = 'cpPilot.cses.token';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const LOGIN_POLL_MS = 2000;

/** CSES login via the browser approval flow. The API token lives in VS Code's SecretStorage. */
export class CsesAuth implements vscode.Disposable {
  private user: CsesUser | undefined;
  private readonly changed = new vscode.EventEmitter<CsesUser | undefined>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly api: CsesApi,
  ) {}

  /** The logged-in user, checking a stored token with CSES if needed. */
  async currentUser(): Promise<CsesUser | undefined> {
    if (this.user) return this.user;
    const token = await this.secrets.get(TOKEN_KEY);
    if (!token) return undefined;
    const status = await this.api.loginStatus(token);
    if (status.state === 'valid') {
      this.setUser(status.user);
    } else {
      await this.secrets.delete(TOKEN_KEY);
    }
    return this.user;
  }

  /** A valid token, starting the login flow if there is none. Undefined if the user doesn't log in. */
  async getToken(): Promise<string | undefined> {
    // If CSES can't be reached the login flow below will report it.
    if (await this.currentUser().catch(() => undefined)) return this.secrets.get(TOKEN_KEY);
    const choice = await vscode.window.showInformationMessage('Log in to CSES to submit.', 'Log In');
    return choice === 'Log In' ? this.login() : undefined;
  }

  /** Call when CSES rejects the token, e.g. after it was revoked on the website. */
  async invalidate(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
    this.setUser(undefined);
  }

  /** Runs the browser login flow. Reports failures to the user itself and returns undefined. */
  async login(): Promise<string | undefined> {
    try {
      return await this.loginFlow();
    } catch (err) {
      vscode.window.showErrorMessage(`CP Pilot: CSES login failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private async loginFlow(): Promise<string | undefined> {
    const { token, authenticationUrl } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'CSES: starting login…' },
      () => this.api.startLogin(),
    );
    const opened = await vscode.env.openExternal(vscode.Uri.parse(authenticationUrl, true));
    if (!opened) {
      await vscode.env.clipboard.writeText(authenticationUrl);
      vscode.window.showInformationMessage('CP Pilot: copied the CSES login link. Open it in your browser.');
    }

    const user = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'CSES: approve the login in your browser…',
        cancellable: true,
      },
      async (_progress, cancel) => {
        const deadline = Date.now() + LOGIN_TIMEOUT_MS;
        while (!cancel.isCancellationRequested && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, LOGIN_POLL_MS));
          // CSES reports a not-yet-approved token as pending or invalid, so keep waiting on both.
          // Network hiccups are retried too; the overall deadline still applies.
          const status = await this.api.loginStatus(token).catch(() => undefined);
          if (status?.state === 'valid') return status.user;
        }
        return undefined;
      },
    );

    if (!user) {
      vscode.window.showWarningMessage('CP Pilot: CSES login was not completed.');
      return undefined;
    }
    await this.secrets.store(TOKEN_KEY, token);
    this.setUser(user);
    vscode.window.showInformationMessage(`CP Pilot: logged in to CSES as ${user.displayname ?? user.username}.`);
    return token;
  }

  async logout(): Promise<void> {
    const token = await this.secrets.get(TOKEN_KEY);
    if (token) await this.api.logout(token).catch(() => {});
    await this.invalidate();
    vscode.window.showInformationMessage('CP Pilot: logged out of CSES.');
  }

  dispose(): void {
    this.changed.dispose();
  }

  private setUser(user: CsesUser | undefined): void {
    this.user = user;
    void vscode.commands.executeCommand('setContext', 'cpPilot.csesLoggedIn', user !== undefined);
    this.changed.fire(user);
  }
}
