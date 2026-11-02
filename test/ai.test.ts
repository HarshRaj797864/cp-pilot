import { describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../src/ai/claude';
import { orderModels } from '../src/ai/modelOrder';
import { plainMath } from '../src/ai/plainText';
import { COMPILE_SYSTEM, DIAGNOSE_SYSTEM, clip, compileErrorPrompt, diagnosePrompt, numberLines, stressPrompt } from '../src/ai/prompts';
import { AiError, extractJson, parseStructured } from '../src/ai/provider';
import { Diagnosis, StressPrograms } from '../src/ai/schemas';

const diagnosis: Diagnosis = {
  summary: 'n * (n + 1) overflows int.',
  cause: 'For n = 200000 the product is about 4e10.',
  lines: [{ line: 4, why: 'int sum' }],
  hint: 'What is the largest value sum can hold?',
  confidence: 'high',
};

describe('prompts', () => {
  it('numbers lines so the model can cite them', () => {
    expect(numberLines('a\nb\r\nc')).toBe('1 | a\n2 | b\n3 | c');
    expect(numberLines(Array(10).fill('x').join('\n')).split('\n')[0]).toBe(' 1 | x');
  });

  it('clips long fields and says so', () => {
    expect(clip('abc', 5)).toBe('abc');
    expect(clip('abcdefgh', 3)).toBe('abc\n… [5 more characters not shown]');
  });

  it('builds a diagnose prompt with the code, test and verdict', () => {
    const p = diagnosePrompt({
      language: 'cpp',
      problemName: 'Missing Number',
      code: 'int main(){}',
      test: { input: '5\n2 3 1 5\n', output: '4\n' },
      verdict: 'WA',
      received: '3\n',
      stderr: '',
    });
    expect(p).toContain('Problem: Missing Number');
    expect(p).toContain('1 | int main(){}');
    expect(p).toContain('<expected_output>\n4\n');
    expect(p).toContain('<student_output>\n3\n');
    expect(p).toContain('Verdict: WA');
    expect(p).toContain('statement is not available');
    expect(p).not.toContain('<stderr>');
  });

  it('asks for a generator only when there is no statement', () => {
    const p = stressPrompt({ language: 'python', problemName: 'X', code: 'print(1)', samples: [{ input: '1', output: '1' }] });
    expect(p).toContain('Write both programs in: Python 3');
    expect(p).toContain('return null for brute');
    expect(p).toContain('<sample_1>');
  });

  it('tells the model to hint, not solve', () => {
    expect(DIAGNOSE_SYSTEM).toMatch(/do not write a corrected solution/);
  });
});

describe('structured output parsing (Copilot path)', () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['Sure! Here it is: {"a":{"b":2}} Hope that helps.', { a: { b: 2 } }],
  ])('extracts JSON from %j', (text, value) => {
    expect(extractJson(text)).toEqual(value);
  });

  it('rejects answers without JSON', () => {
    expect(() => extractJson('no json here')).toThrow(AiError);
  });

  it('validates against the schema and explains failures', () => {
    expect(parseStructured(Diagnosis, JSON.stringify(diagnosis))).toEqual({ ok: true, value: diagnosis });
    const bad = parseStructured(Diagnosis, JSON.stringify({ ...diagnosis, confidence: 'certain' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/confidence/);
    expect(parseStructured(StressPrograms, '{"input_format":"n","generator":"x","brute":null,"notes":""}').ok).toBe(true);
  });
});

describe('ClaudeProvider', () => {
  /** A fetch that records the request and answers like the Messages API. */
  function fakeApi(reply: { status?: number; body: unknown }) {
    const calls: { url: string; headers: Headers; body: any }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
      });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  const message = (text: string, stop_reason = 'end_turn') => ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  });

  it('sends a structured-output request with the refusal fallback and parses the answer', async () => {
    const { calls, fetchImpl } = fakeApi({ body: message(JSON.stringify(diagnosis)) });
    const provider = new ClaudeProvider('sk-ant-test', 'claude-sonnet-5-5', fetchImpl);
    const result = await provider.generate({ system: 'sys', prompt: 'why?', schema: Diagnosis });

    expect(result).toEqual(diagnosis);
    expect(calls).toHaveLength(1);
    const { url, headers, body } = calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    // SDK 1.x sends the key as a bearer token.
    expect(headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', system: 'sys', fallbacks: 'default' });
    expect(body.messages).toEqual([{ role: 'user', content: 'why?' }]);
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.required).toEqual(expect.arrayContaining(['summary', 'hint', 'confidence']));
  });

  it('reports refusals and truncation as readable errors', async () => {
    const refused = new ClaudeProvider('k', undefined, fakeApi({ body: message('', 'refusal') }).fetchImpl);
    await expect(refused.generate({ system: '', prompt: '', schema: Diagnosis })).rejects.toThrow(/declined/);
    const cut = new ClaudeProvider('k', undefined, fakeApi({ body: message('{"summ', 'max_tokens') }).fetchImpl);
    await expect(cut.generate({ system: '', prompt: '', schema: Diagnosis })).rejects.toThrow(/cut off/);
  });

  it('turns a rejected key into advice', async () => {
    const api = fakeApi({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    const provider = new ClaudeProvider('bad', undefined, api.fetchImpl);
    await expect(provider.generate({ system: '', prompt: '', schema: Diagnosis })).rejects.toThrow(/Set Claude API Key/);
  });
});

describe('orderModels (Copilot fallback order)', () => {
  it('tries the last working model, then preferences, then the rest in Copilot order', () => {
    const models = [
      { id: 'a', family: 'gpt-5.6-luna' },
      { id: 'b', family: 'o-mini' },
      { id: 'c', family: 'claude-sonnet-5' },
      { id: 'd', family: 'gpt-4.1' },
    ];
    expect(orderModels(models, '').map((m) => m.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(orderModels(models, 'gpt-4.1').map((m) => m.id)).toEqual(['d', 'c', 'a', 'b']);
    expect(orderModels(models, '', 'b').map((m) => m.id)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('plainMath', () => {
  it.each([
    // From a real answer that rendered raw in the panel.
    ['For $n=5$, line 7 uses $n(n-1)/2=10$ instead of $n(n+1)/2=15$.', 'For n=5, line 7 uses n(n-1)/2=10 instead of n(n+1)/2=15.'],
    ['the sum $1+\\dots+n$', 'the sum 1+…+n'],
    ['$2 \\le n \\le 2 \\cdot 10^5$', '2 ≤ n ≤ 2 · 10^5'],
    ['$\\frac{n}{2}$ and $\\text{ans}$', '(n)/(2) and ans'],
    ['plain text stays', 'plain text stays'],
  ])('%j', (input, output) => {
    expect(plainMath(input)).toBe(output);
  });
});

describe('compile error prompt', () => {
  it('sends numbered code and the compiler output, and asks for the concrete fix', () => {
    const p = compileErrorPrompt({
      language: 'cpp',
      code: 'int main() {\n  int x = 1\n}',
      compilerOutput: "a.cpp:2:12: error: expected ';' before '}' token",
    });
    expect(p).toContain('Language: C++17');
    expect(p).toContain('2 |   int x = 1');
    expect(p).toContain("<compiler_output>\na.cpp:2:12: error: expected ';' before '}' token\n</compiler_output>");
    expect(COMPILE_SYSTEM).toMatch(/concrete fix/);
    expect(COMPILE_SYSTEM).toMatch(/first real cause/);
  });
});
