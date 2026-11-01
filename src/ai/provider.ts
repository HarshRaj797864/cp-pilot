import { z } from 'zod';

export interface StructuredRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

/** Something that turns a prompt into a validated, typed object. */
export interface AiProvider {
  /** Shown to the user, e.g. "Claude Sonnet 5.5 (your API key)". */
  readonly label: string;
  generate<T>(req: StructuredRequest<T>): Promise<T>;
}

/** A failure worth showing to the user as-is (no key, refusal, quota, unparseable answer…). */
export class AiError extends Error {}

/**
 * Pulls a JSON object out of a model's text answer: a bare object, or one inside a ``` fence,
 * or the outermost {...} when the model added prose around it.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new AiError('The AI answer did not contain JSON.');
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new AiError('The AI answer contained malformed JSON.');
    }
  }
}

/** Validates against the schema, with an error message that can be fed back to the model. */
export function parseStructured<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: z.prettifyError(result.error) };
}
