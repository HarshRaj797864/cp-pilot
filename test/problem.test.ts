import { describe, expect, it } from 'vitest';
import { InvalidProblemError, parseCompanionPayload } from '../src/core/problem';
import { solutionFileName, toFileStem } from '../src/core/naming';

const csesPayload = {
  name: 'Weird Algorithm',
  group: 'CSES - CSES Problem Set',
  url: 'https://cses.fi/problemset/task/1068',
  interactive: false,
  memoryLimit: 512,
  timeLimit: 1000,
  tests: [{ input: '3\n', output: '3 10 5 16 8 4 2 1\n' }],
  testType: 'single',
  input: { type: 'stdin' },
  output: { type: 'stdout' },
  languages: { java: { mainClass: 'Main', taskClass: 'WeirdAlgorithm' } },
  batch: { id: 'abc', size: 1 },
};

describe('parseCompanionPayload', () => {
  it('parses a real Competitive Companion payload', () => {
    expect(parseCompanionPayload(csesPayload)).toEqual({
      name: 'Weird Algorithm',
      group: 'CSES - CSES Problem Set',
      url: 'https://cses.fi/problemset/task/1068',
      interactive: false,
      memoryLimit: 512,
      timeLimit: 1000,
      tests: [{ input: '3\n', output: '3 10 5 16 8 4 2 1\n' }],
    });
  });

  it('fills defaults for optional fields', () => {
    const p = parseCompanionPayload({ name: 'X', tests: [] });
    expect(p).toMatchObject({ group: '', url: '', interactive: false, timeLimit: 0, memoryLimit: 0 });
  });

  it.each([
    [null],
    ['string'],
    [{ tests: [] }],
    [{ name: '  ', tests: [] }],
    [{ name: 'X' }],
    [{ name: 'X', tests: [{ input: '1' }] }],
  ])('rejects invalid payload %j', (payload) => {
    expect(() => parseCompanionPayload(payload)).toThrow(InvalidProblemError);
  });
});

describe('naming', () => {
  it.each([
    ['A. Watermelon', 'A_Watermelon'],
    ['Weird Algorithm', 'Weird_Algorithm'],
    ['D2. Résumé (hard version)', 'D2_Resume_hard_version'],
    ['!!!', 'problem'],
  ])('toFileStem(%j) = %j', (name, stem) => {
    expect(toFileStem(name)).toBe(stem);
  });

  it('adds the language extension', () => {
    expect(solutionFileName({ name: 'A. Watermelon', url: '' }, 'python')).toBe('A_Watermelon.py');
    expect(solutionFileName({ name: 'A. Watermelon', url: '' }, 'cpp', 2)).toBe('A_Watermelon_2.cpp');
  });
});
