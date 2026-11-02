import { Verdict } from '../core/judge';
import { Language } from '../core/naming';
import { TestCase } from '../core/problem';

/** Keeps prompts small when a test or output is huge; the model is told it was cut. */
export const MAX_FIELD_CHARS = 4000;

const LANGUAGE_NAMES: Record<Language, string> = {
  cpp: 'C++17',
  c: 'C11',
  python: 'Python 3',
  java: 'Java (single file, run with `java File.java`)',
  rust: 'Rust',
  go: 'Go',
  js: 'JavaScript (Node.js)',
};

export function clip(text: string, max = MAX_FIELD_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${text.length - max} more characters not shown]`;
}

/** "  1 | code" numbering so the model can point at lines the editor shows. */
export function numberLines(code: string): string {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width)} | ${l}`).join('\n');
}

function block(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}

export const DIAGNOSE_SYSTEM = `You are a competitive programming coach helping a student debug their own solution while practising.
You are given the student's code, one test where it fails, and sometimes the problem statement.
Find the most likely reason it fails this test: wrong algorithm, overflow, off-by-one, uninitialised or reused state between test cases, wrong output format, missed edge case, too slow, and so on.
Point at the specific lines involved, using the line numbers shown in the code.
Give a hint that leads the student to the fix, but do not write a corrected solution or replacement code: the student learns more by fixing it.
If the expected output is ambiguous (several answers may be accepted), say so instead of calling a valid answer wrong.
Be concise and concrete.
Your text is shown as plain text in a narrow panel: write math the way code does (n*(n+1)/2, a[i] <= x), never LaTeX ($...$, \\le) or Markdown.`;

export interface DiagnoseInput {
  language: Language;
  problemName: string;
  statement?: string;
  code: string;
  test: TestCase;
  verdict: Verdict;
  received: string;
  stderr: string;
  message?: string;
}

export function diagnosePrompt(d: DiagnoseInput): string {
  return [
    `Problem: ${d.problemName}`,
    `Language: ${LANGUAGE_NAMES[d.language]}`,
    d.statement ? block('statement', clip(d.statement, 12000)) : 'The problem statement is not available.',
    block('code', numberLines(d.code)),
    block('test_input', clip(d.test.input)),
    block('expected_output', clip(d.test.output)),
    block('student_output', clip(d.received || '(empty)')),
    `Verdict: ${d.verdict}${d.message ? ` (${d.message})` : ''}`,
    d.stderr.trim() ? block('stderr', clip(d.stderr)) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const STRESS_SYSTEM = `You write programs for stress testing a competitive programming solution.
1. A test generator: it reads a single integer seed from standard input, seeds its random number generator with it, and prints exactly one valid test in the problem's input format. Keep tests SMALL (for example n <= 8 and values <= 20) so a slow brute force finishes instantly and failing tests are easy to read, but vary sizes and include edge cases (minimum sizes, equal values, extremes of the small range) across seeds. If the input holds several test cases, print a valid count followed by that many.
2. A brute force, only when the problem statement is given: the simplest obviously correct solution, as slow as you like (exhaustive search is ideal). It must not reuse the student's approach. If no statement is given, return null for it.
Infer the input format from the samples, the statement if present, and how the student's code reads input.
Both programs must be complete and compile on their own in the requested language, using only the standard library, reading stdin and writing stdout.`;

export interface StressInput {
  language: Language;
  problemName: string;
  statement?: string;
  code: string;
  samples: TestCase[];
}

export function stressPrompt(s: StressInput): string {
  const samples = s.samples
    .slice(0, 3)
    .map((t, i) => block(`sample_${i + 1}`, `${block('input', clip(t.input, 1500))}\n${block('output', clip(t.output, 1500))}`));
  return [
    `Problem: ${s.problemName}`,
    `Write both programs in: ${LANGUAGE_NAMES[s.language]}`,
    s.statement ? block('statement', clip(s.statement, 12000)) : 'No problem statement is available: write the generator only and return null for brute.',
    ...samples,
    block('student_code', clip(s.code, 8000)),
  ].join('\n\n');
}

export const COMPILE_SYSTEM = `You explain compiler errors to a competitive programmer, in plain words.
You are given their code with line numbers and the compiler's output. Compiler messages are often long and cryptic (template errors, cascades of follow-on errors); find the first real cause.
Say what the error means, point at the line(s) that cause it using the line numbers shown, and give the concrete fix (for example "add a semicolon at the end of line 7" or "declare x before line 12"). Fixing a compile error is fine to spell out; don't rewrite the algorithm or comment on whether the solution is correct.
If one mistake causes several errors, say so and focus on that mistake.
Your text is shown as plain text in a narrow panel: write code the way it appears in the file, never LaTeX or Markdown.`;

export interface CompileErrorInput {
  language: Language;
  code: string;
  compilerOutput: string;
}

export function compileErrorPrompt(c: CompileErrorInput): string {
  return [
    `Language: ${LANGUAGE_NAMES[c.language]}`,
    block('code', numberLines(c.code)),
    block('compiler_output', clip(c.compilerOutput, 6000)),
  ].join('\n\n');
}
