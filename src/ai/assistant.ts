import * as vscode from 'vscode';
import { contestStatus } from '../core/contestGuard';
import { Problem } from '../core/problem';
import { csesTaskId } from '../cses/api';
import { fetchCsesStatement } from '../cses/statement';
import { ClaudeProvider, DEFAULT_CLAUDE_MODEL } from './claude';
import { CopilotProvider } from './copilot';
import { plainDiagnosis } from './plainText';
import {
  COMPILE_SYSTEM,
  CompileErrorInput,
  DIAGNOSE_SYSTEM,
  DiagnoseInput,
  STRESS_SYSTEM,
  StressInput,
  compileErrorPrompt,
  diagnosePrompt,
  stressPrompt,
} from './prompts';
import { AiError, AiProvider } from './provider';
import { Diagnosis, StressPrograms } from './schemas';

const KEY_SECRET = 'cpPilot.ai.claudeApiKey';

type ProviderSetting = 'auto' | 'copilot' | 'claude';

/** AI features: provider choice, the Claude key, the live-contest guard, and the two requests. */
export class AiAssistant {
  /** Problems the user confirmed are practice, so they're asked once per session. */
  private readonly confirmedPractice = new Set<string>();

  constructor(private readonly secrets: vscode.SecretStorage) {}

  get enabled(): boolean {
    return vscode.workspace.getConfiguration('cpPilot.ai').get<boolean>('enabled', true);
  }

  async diagnose(problem: Problem, input: DiagnoseInput, signal?: AbortSignal): Promise<{ diagnosis: Diagnosis; by: string }> {
    await this.ensurePractice(problem);
    const provider = await this.provider();
    const statement = await this.statementFor(problem);
    const diagnosis = await provider.generate({
      system: DIAGNOSE_SYSTEM,
      prompt: diagnosePrompt({ ...input, statement: input.statement ?? statement }),
      schema: Diagnosis,
      signal,
    });
    return { diagnosis: plainDiagnosis(diagnosis), by: provider.label };
  }

  /** Explains a compiler error in plain words (same card shape as a failing test). */
  async explainCompileError(problem: Problem, input: CompileErrorInput, signal?: AbortSignal): Promise<{ diagnosis: Diagnosis; by: string }> {
    await this.ensurePractice(problem);
    const provider = await this.provider();
    const diagnosis = await provider.generate({ system: COMPILE_SYSTEM, prompt: compileErrorPrompt(input), schema: Diagnosis, signal });
    return { diagnosis: plainDiagnosis(diagnosis), by: provider.label };
  }

  async stressPrograms(problem: Problem, input: StressInput, signal?: AbortSignal): Promise<{ programs: StressPrograms; by: string }> {
    await this.ensurePractice(problem);
    const provider = await this.provider();
    const programs = await provider.generate({ system: STRESS_SYSTEM, prompt: stressPrompt(input), schema: StressPrograms, signal });
    return { programs, by: provider.label };
  }

  /** The statement when CP Pilot can get it itself (CSES); undefined otherwise. */
  async statementFor(problem: Problem): Promise<string | undefined> {
    const taskId = csesTaskId(problem.url);
    if (!taskId) return undefined;
    return fetchCsesStatement(taskId).catch(() => undefined);
  }

  async setClaudeKey(): Promise<void> {
    const key = await vscode.window.showInputBox({
      title: 'Claude API key',
      prompt: 'Create one at console.anthropic.com → API Keys. It is stored in VS Code’s secret storage.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().startsWith('sk-ant-') ? undefined : 'Claude API keys start with "sk-ant-"'),
    });
    if (!key) return;
    await this.secrets.store(KEY_SECRET, key.trim());
    vscode.window.showInformationMessage('CP Pilot: Claude API key saved.');
  }

  async clearClaudeKey(): Promise<void> {
    await this.secrets.delete(KEY_SECRET);
    vscode.window.showInformationMessage('CP Pilot: Claude API key removed.');
  }

  /**
   * AI help is for practice: Codeforces and AtCoder restrict it during rated rounds. Live contests are
   * refused; when CP Pilot can't tell, the user confirms once per problem.
   */
  private async ensurePractice(problem: Problem): Promise<void> {
    if (this.confirmedPractice.has(problem.url)) return;
    const status = await contestStatus(problem.url);
    if (status.status === 'practice') return;
    if (status.status === 'live') {
      const until = status.endsAt ? ` until ${status.endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
      throw new AiError(`AI help is turned off while ${status.contest} is running${until}. It's for practice and upsolving only.`);
    }
    const choice = await vscode.window.showWarningMessage(
      `Is this problem from a contest that's running right now? AI help is for practice only (${status.reason}).`,
      { modal: true },
      "It's practice",
    );
    if (choice !== "It's practice") throw new AiError('Cancelled.');
    this.confirmedPractice.add(problem.url);
  }

  private async provider(): Promise<AiProvider> {
    const config = vscode.workspace.getConfiguration('cpPilot.ai');
    const setting = config.get<ProviderSetting>('provider', 'auto');
    const model = config.get<string>('claudeModel', DEFAULT_CLAUDE_MODEL) || DEFAULT_CLAUDE_MODEL;

    // VS Code's own switch hides Copilot from extensions too; say so instead of "install Copilot".
    const aiDisabledInVsCode = vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures', false);
    if (setting !== 'claude') {
      const copilot = await CopilotProvider.create(config.get<string>('copilotModelFamily', ''));
      if (copilot) return copilot;
      if (setting === 'copilot') {
        throw new AiError(
          aiDisabledInVsCode
            ? 'VS Code\'s AI features are turned off ("Chat: Disable AI Features"). Turn them on and sign in to Copilot.'
            : 'No GitHub Copilot models are available. Sign in to Copilot in VS Code, or switch cpPilot.ai.provider.',
        );
      }
    }

    let key = await this.secrets.get(KEY_SECRET);
    if (!key) {
      const copilotAction = aiDisabledInVsCode ? 'Turn On AI Features' : 'Set Up Copilot';
      const choice = await vscode.window.showInformationMessage(
        aiDisabledInVsCode
          ? 'AI features need GitHub Copilot or a Claude API key, but VS Code\'s AI features are turned off ("Chat: Disable AI Features").'
          : 'AI features need GitHub Copilot (sign in to Copilot in VS Code) or your own Claude API key.',
        'Set Claude API Key',
        copilotAction,
      );
      if (choice === copilotAction) {
        if (aiDisabledInVsCode) void vscode.commands.executeCommand('workbench.action.openSettings', 'chat.disableAIFeatures');
        else void vscode.commands.executeCommand('workbench.action.chat.open');
      } else if (choice === 'Set Claude API Key') {
        await this.setClaudeKey();
        key = await this.secrets.get(KEY_SECRET);
      }
      if (!key) throw new AiError('No AI provider is set up.');
    }
    return new ClaudeProvider(key, model);
  }
}
