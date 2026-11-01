import * as vscode from 'vscode';
import { z } from 'zod';
import { AiError, AiProvider, StructuredRequest, parseStructured } from './provider';

/** Preferred Copilot model families, best first; otherwise the first model Copilot offers. */
const PREFERRED_FAMILIES = ['claude-sonnet', 'gpt-5', 'claude', 'gpt-4.1', 'gpt-4o'];

/**
 * Models from GitHub Copilot through VS Code's Language Model API: no API key needed for anyone with
 * Copilot (free for students). This API has no structured-output mode, so the schema goes into the
 * prompt and the answer is validated, with one retry that shows the model its validation error.
 */
export class CopilotProvider implements AiProvider {
  private constructor(private readonly model: vscode.LanguageModelChat) {}

  /** Undefined when Copilot isn't installed or signed in. */
  static async create(preferredFamily = ''): Promise<CopilotProvider | undefined> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) return undefined;
    const families = preferredFamily ? [preferredFamily, ...PREFERRED_FAMILIES] : PREFERRED_FAMILIES;
    for (const family of families) {
      const match = models.find((m) => m.family.toLowerCase().includes(family.toLowerCase()));
      if (match) return new CopilotProvider(match);
    }
    return new CopilotProvider(models[0]);
  }

  get label(): string {
    return `${this.model.name} (GitHub Copilot)`;
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

  private async send(messages: vscode.LanguageModelChatMessage[], signal?: AbortSignal): Promise<string> {
    const cancel = new vscode.CancellationTokenSource();
    signal?.addEventListener('abort', () => cancel.cancel(), { once: true });
    try {
      const response = await this.model.sendRequest(
        messages,
        { justification: 'CP Pilot uses a language model to explain failing tests and write stress tests.' },
        cancel.token,
      );
      let text = '';
      for await (const chunk of response.text) text += chunk;
      return text;
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        if (err.code === vscode.LanguageModelError.NoPermissions.name) {
          throw new AiError('CP Pilot needs your permission to use Copilot models. Allow it when VS Code asks.');
        }
        if (err.code === vscode.LanguageModelError.Blocked.name) {
          throw new AiError('Copilot blocked this request (for example a quota or content filter).');
        }
        throw new AiError(`Copilot error: ${err.message}`);
      }
      throw err;
    } finally {
      cancel.dispose();
    }
  }
}
