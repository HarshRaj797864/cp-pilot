import { z } from 'zod';

/** Answer to "why did this test fail?". Hints, not a rewritten solution: this is a practice tool. */
export const Diagnosis = z.object({
  summary: z.string().describe('One sentence naming the most likely bug.'),
  cause: z.string().describe('Short explanation of why the code produces the wrong result on this test.'),
  lines: z
    .array(
      z.object({
        line: z.number().int().describe('1-based line number in the numbered code.'),
        why: z.string().describe('What is wrong or suspicious on that line.'),
      }),
    )
    .describe('The lines involved, most relevant first. Empty if the bug is not tied to specific lines.'),
  hint: z.string().describe('A nudge toward the fix that leaves the actual fix to the student.'),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

/** Programs for stress testing, written in the same language as the student's solution. */
export const StressPrograms = z.object({
  input_format: z.string().describe('The input format as understood from the samples, statement and code.'),
  generator: z
    .string()
    .describe('Complete program: reads one integer seed from stdin, prints exactly one small valid test.'),
  brute: z
    .string()
    .nullable()
    .describe('Complete, simple, obviously correct (slow is fine) solution, or null if no statement was given.'),
  notes: z.string().describe('Assumptions made, e.g. about constraints that were not visible.'),
});
export type StressPrograms = z.infer<typeof StressPrograms>;
