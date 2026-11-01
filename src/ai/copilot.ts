import * as vscode from 'vscode';
import { z } from 'zod';
import { orderModels } from './modelOrder';
import { AiError, AiProvider, StructuredRequest, parseStructured } from './provider';

/** The model that last worked, so later requests skip models that refused. */
let workingModelId: string | undefined;

/**
 * Models from GitHub Copilot through VS Code's Language Model API: no API key needed for anyone with
 * Copilot (free for students). This API has no structured-output mode, so the schema goes into the
 * prompt and the answer is validated, with one retry that shows the model its validation error.
 *
 * Copilot can list models that extensions aren't allowed to use (e.g. "only available to VS Code
 * core"), so requests try the candidates in order of preference until one accepts.
 */
export class CopilotProvider implements AiProvider {
  private current: vscode.LanguageModelChat;

  private constructor(private readonly candidates: vscode.LanguageModelChat[]) {
    this.current = candidates[0];
  }

  /** Undefined when Copilot isn't installed or signed in. */
  static async create(preferredFamily = ''): Promise<CopilotProvider | undefined> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) return undefined;
    return new CopilotProvider(orderModels(models, preferredFamily, workingModelId));
  }

  get label(): string {
    return `${this.current.name} (GitHub Copilot)`;
  }

  async generate<T>(req: StructuredRequest<T>): Promise<T> {
    const instructions =
      `${req.system}\n\nAnswer with only a JSON object (no prose, no code fence) matching this JSON Schema:\n` +
      JSON.stringify(z.toJSONSchema(req.schema));
    const messages = [vscode.LanguageModelChatMessage.User(`${instructions}\n\n${req.prompt}`)];

    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.send(messages, req.signal);
      const parsed = parseStructured(req.schema, text);
      if (parsed.ok) return parsed.value;
      messages.push(
        vscode.LanguageModelChatMessage.Assistant(text),
        vscode.LanguageModelChatMessage.User(
          `That JSON didn't match the schema:\n${parsed.error}\nReply again with only the corrected JSON object.`,
        ),
      );
    }
    throw new AiError("Copilot's answer didn't match the expected format. Please try again.");
  }

  /** Sends to the first candidate model that accepts the request. */
  private async send(messages: vscode.LanguageModelChatMessage[], signal?: AbortSignal): Promise<string> {
    const refusals: string[] = [];
    for (const model of this.candidates) {
      try {
        const text = await sendTo(model, messages, signal);
        this.current = model;
        workingModelId = model.id;
        return text;
      } catch (err) {
        if (signal?.aborted) throw err;
        // The user declined access: asking other models would just ask again.
        if (err instanceof vscode.LanguageModelError && err.code === vscode.LanguageModelError.NoPermissions.name) {
          throw new AiError('CP Pilot needs your permission to use Copilot models. Allow it when VS Code asks.');
        }
        refusals.push(`${model.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new AiError(`None of Copilot's models accepted the request.\n${refusals.slice(0, 3).join('\n')}`);
  }
}

async function sendTo(model: vscode.LanguageModelChat, messages: vscode.LanguageModelChatMessage[], signal?: AbortSignal): Promise<string> {
  const cancel = new vscode.CancellationTokenSource();
  signal?.addEventListener('abort', () => cancel.cancel(), { once: true });
  try {
    const response = await model.sendRequest(
      messages,
      { justification: 'CP Pilot uses a language model to explain failing tests and write stress tests.' },
      cancel.token,
    );
    let text = '';
    for await (const chunk of response.text) text += chunk;
    return text;
  } finally {
    cancel.dispose();
  }
}

