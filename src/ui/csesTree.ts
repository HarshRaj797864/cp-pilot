import * as vscode from 'vscode';
import { CsesApi, CsesUser } from '../cses/api';
import { CsesAuth } from '../cses/auth';
import { CsesCategory, CsesProblem, ListFilter, countSolved, filterProblems, withStatus } from '../cses/problemList';

const CACHE_KEY = 'cpPilot.cses.problemList';
const HIDE_SOLVED_KEY = 'cpPilot.cses.hideSolved';
/** Background refresh when the cached list is older than this. */
const STALE_MS = 10 * 60_000;

interface CachedList {
  categories: CsesCategory[];
  /** Username the statuses belong to; undefined for a logged-out fetch. */
  user?: string;
  fetchedAt: number;
}

type Node =
  | { kind: 'info'; label: string; description?: string; icon: string; command?: vscode.Command; tooltip?: string }
  | { kind: 'category'; category: CsesCategory; total: number; solved: number }
  | { kind: 'problem'; problem: CsesProblem };

/** Sidebar list of the CSES problem set with the user's solved/attempted status. */
export class CsesProblemsProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  static readonly viewId = 'cpPilot.csesProblems';

  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  private view: vscode.TreeView<Node> | undefined;
  private list: CachedList | undefined;
  private user: CsesUser | undefined;
  /** False until we know who is logged in; until then a cached list's statuses are shown as-is. */
  private userChecked = false;
  private stale = false;
  private filter: ListFilter;
  private loading: Promise<void> | undefined;
  private error: string | undefined;
  /** Bumped when the filter changes so categories get fresh ids and open expanded. */
  private filterGeneration = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly state: vscode.Memento,
    private readonly api: CsesApi,
    private readonly auth: CsesAuth,
  ) {
    this.list = state.get<CachedList>(CACHE_KEY);
    this.filter = { query: '', hideSolved: state.get<boolean>(HIDE_SOLVED_KEY, false) };
    this.updateContext();
    this.disposables.push(
      auth.onDidChange((user) => {
        const changedUser = user?.username !== this.user?.username || !this.userChecked;
        this.user = user;
        this.userChecked = true;
        if (!changedUser) return;
        // Statuses belong to the previous user now; reload, or wait until the view is opened.
        this.stale = true;
        if (this.view?.visible) void this.refresh();
        else this.changed.fire();
      }),
    );
  }

  attach(view: vscode.TreeView<Node>): void {
    this.view = view;
    this.updateDescription();
    this.disposables.push(
      view.onDidChangeVisibility((e) => {
        if (e.visible && this.isStale()) void this.refresh();
      }),
    );
    if (view.visible && this.isStale()) void this.refresh();
  }

  /** Reloads the list (with the user's status when logged in). Concurrent calls share one request. */
  refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => {
      this.loading = undefined;
      this.changed.fire();
    });
    this.changed.fire();
    return this.loading;
  }

  /** Marks a problem solved right away, then confirms with CSES. */
  markSolved(taskId: string): void {
    if (this.list) {
      this.list = { ...this.list, categories: withStatus(this.list.categories, taskId, 'solved') };
      this.changed.fire();
    }
    void this.refresh();
  }

  async search(): Promise<void> {
    const query = await vscode.window.showInputBox({
      title: 'Search CSES problems',
      prompt: 'Part of a problem name, or a task id. Leave empty to show all.',
      value: this.filter.query,
    });
    if (query === undefined) return;
    this.setFilter({ ...this.filter, query });
  }

  clearSearch(): void {
    this.setFilter({ ...this.filter, query: '' });
  }

  setHideSolved(hideSolved: boolean): void {
    void this.state.update(HIDE_SOLVED_KEY, hideSolved);
    this.setFilter({ ...this.filter, hideSolved });
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'info': {
        const item = new vscode.TreeItem(node.label);
        item.description = node.description;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.command = node.command;
        item.tooltip = node.tooltip;
        return item;
      }
      case 'category': {
        const expanded = this.filter.query !== '';
        const item = new vscode.TreeItem(
          node.category.name,
          expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.id = `category:${node.category.name}:${this.filterGeneration}`;
        item.description = this.showsStatus() ? `${node.solved}/${node.total}` : `${node.total}`;
        item.iconPath = new vscode.ThemeIcon(
          node.solved === node.total && this.showsStatus() ? 'pass-filled' : 'folder',
          node.solved === node.total && this.showsStatus() ? new vscode.ThemeColor('testing.iconPassed') : undefined,
        );
        return item;
      }
      case 'problem': {
        const { problem } = node;
        const item = new vscode.TreeItem(problem.name);
        item.id = `problem:${problem.id}`;
        item.description = problem.id;
        item.tooltip = `${problem.name} (task ${problem.id})${statusLabel(problem)}\nClick to open on cses.fi`;
        item.iconPath = this.showsStatus() ? statusIcon(problem) : new vscode.ThemeIcon('circle-outline');
        item.command = { command: 'cpPilot.cses.openProblem', title: 'Open on CSES', arguments: [problem.url] };
        item.contextValue = 'csesProblem';
        return item;
      }
    }
  }

  getChildren(node?: Node): Node[] {
    if (node?.kind === 'category') return node.category.problems.map((problem) => ({ kind: 'problem', problem }));
    if (node) return [];

    if (!this.list) {
      if (this.error) return [this.retryNode()];
      return [{ kind: 'info', label: 'Loading CSES problems…', icon: 'loading~spin' }];
    }

    const all = this.list.categories;
    const totals = new Map(all.map((c) => [c.name, { total: c.problems.length, solved: countSolved(c.problems) }]));
    const visible = filterProblems(all, this.filter);
    const header = this.headerNode(all);
    const nodes: Node[] = header ? [header] : [];
    if (this.error) nodes.push(this.retryNode());
    if (visible.length === 0) {
      nodes.push({ kind: 'info', label: this.filter.query ? 'No problems match your search' : 'All solved here 🎉', icon: 'info' });
    }
    for (const category of visible) nodes.push({ kind: 'category', category, ...totals.get(category.name)! });
    return nodes;
  }

  dispose(): void {
    this.changed.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  private async load(): Promise<void> {
    try {
      this.user = await this.auth.currentUser().catch(() => undefined);
      this.userChecked = true;
      const token = this.user ? await this.auth.token() : undefined;
      const categories = await this.api.getProblemList(token);
      this.list = { categories, user: this.user?.username, fetchedAt: Date.now() };
      this.error = undefined;
      this.stale = false;
      await this.state.update(CACHE_KEY, this.list);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  private headerNode(all: CsesCategory[]): Node | undefined {
    if (!this.showsStatus()) {
      return {
        kind: 'info',
        label: 'Log in to see your progress',
        icon: 'account',
        command: { command: 'cpPilot.cses.login', title: 'Log In to CSES' },
      };
    }
    const problems = all.flatMap((c) => c.problems);
    return {
      kind: 'info',
      label: `Solved ${countSolved(problems)} / ${problems.length}`,
      description: this.list?.user,
      icon: 'graph',
      tooltip: this.loading ? 'Refreshing…' : `Updated ${new Date(this.list!.fetchedAt).toLocaleTimeString()}`,
    };
  }

  private retryNode(): Node {
    return {
      kind: 'info',
      label: "Couldn't load CSES problems",
      description: 'click to retry',
      icon: 'warning',
      tooltip: this.error,
      command: { command: 'cpPilot.cses.refreshProblems', title: 'Retry' },
    };
  }

  /** Statuses are only meaningful for a list fetched as the currently logged-in user. */
  private showsStatus(): boolean {
    if (this.list?.user === undefined) return false;
    return !this.userChecked || this.user?.username === this.list.user;
  }

  private isStale(): boolean {
    return this.stale || !this.list || Date.now() - this.list.fetchedAt > STALE_MS;
  }

  private setFilter(filter: ListFilter): void {
    this.filter = filter;
    this.filterGeneration++;
    this.updateContext();
    this.updateDescription();
    this.changed.fire();
  }

  private updateDescription(): void {
    if (!this.view) return;
    const parts = [this.filter.query && `“${this.filter.query}”`, this.filter.hideSolved && 'unsolved only'].filter(Boolean);
    this.view.description = parts.join(' · ') || undefined;
  }

  private updateContext(): void {
    void vscode.commands.executeCommand('setContext', 'cpPilot.cses.searching', this.filter.query !== '');
    void vscode.commands.executeCommand('setContext', 'cpPilot.cses.hidingSolved', this.filter.hideSolved);
  }
}

function statusIcon(problem: CsesProblem): vscode.ThemeIcon {
  switch (problem.status) {
    case 'solved':
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    case 'attempted':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'none':
      return new vscode.ThemeIcon('circle-outline');
  }
}

function statusLabel(problem: CsesProblem): string {
  return problem.status === 'solved' ? ' · solved' : problem.status === 'attempted' ? ' · attempted' : '';
}
