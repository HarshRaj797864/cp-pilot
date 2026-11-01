import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { transportFetch } from '../core/http';
import { AiError, AiProvider, StructuredRequest, parseStructured } from './provider';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';

/** Claude through the official SDK with the user's own API key. */
export class ClaudeProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_CLAUDE_MODEL,
    // IPv4-first transport: Node's fetch can hang on networks with broken IPv6 (common under WSL).
    fetchImpl: typeof fetch = transportFetch(),
  ) {
    this.client = new Anthropic({ apiKey, fetch: fetchImpl, maxRetries: 2 });
  }

  get label(): string {
    return `${this.model} (your Claude API key)`;
  }

  async generate<T>(req: StructuredRequest<T>): Promise<T> {
    let message;
    try {
      // create() rather than parse(): parse() throws on a refused (empty) answer before stop_reason can be read.
      message = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          system: req.system,
          messages: [{ role: 'user', content: req.prompt }],
          output_config: { format: zodOutputFormat(req.schema) },
          // If a safety classifier wrongly declines (it can on code), retry server-side on the recommended model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: req.signal },
      );
    } catch (err) {
      throw toAiError(err);
    }

    if (message.stop_reason === 'refusal') {
      throw new AiError('Claude declined this request. Try rephrasing, or use a different provider.');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new AiError('The AI answer was cut off before it finished. Please try again.');
    }
    const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const parsed = parseStructured(req.schema, text);
    if (!parsed.ok) throw new AiError("The AI answer didn't match the expected format. Please try again.");
    return parsed.value;
  }
}

function toAiError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('Your Claude API key was rejected. Set a new one with "CP Pilot: Set Claude API Key".');
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("Your Claude API key isn't allowed to use this model.");
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiError('That Claude model was not found. Check the cpPilot.ai.claudeModel setting.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('Claude rate limit or credit limit reached. Wait a moment, or check your Anthropic Console billing.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError("Couldn't reach the Claude API. Check your internet connection.");
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`Claude API error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
