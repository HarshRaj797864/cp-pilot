import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCommands, languageFromPath, resolveCommands, shellQuote } from '../src/core/languages';

describe('languageFromPath', () => {
  it.each([
    ['a/Weird_Algorithm.cpp', 'cpp'],
    ['x.PY', 'python'],
    ['Main.java', 'java'],
    ['notes.txt', undefined],
  ])('%s -> %s', (file, lang) => {
    expect(languageFromPath(file)).toBe(lang);
  });
});

describe('resolveCommands', () => {
  it('fills placeholders with quoted paths and puts binaries in .cp-pilot/bin', () => {
    const file = path.join('/work', 'my dir', 'A.cpp');
    const r = resolveCommands(file, defaultCommands('linux').cpp, 'linux');
    const exe = path.join('/work', 'my dir', '.cp-pilot', 'bin', 'A_cpp');
    expect(r.exe).toBe(exe);
    expect(r.compile).toBe(`g++ -std=gnu++17 -O2 -Wall -o '${exe}' '${file}'`);
    expect(r.run).toBe(`'${exe}'`);
  });

  it('adds .exe on Windows and has no compile step for interpreted languages', () => {
    expect(resolveCommands('A.cpp', defaultCommands('win32').cpp, 'win32').exe).toMatch(/A_cpp\.exe$/);
    const py = resolveCommands('A.py', defaultCommands('win32').python, 'win32');
    expect(py.compile).toBeUndefined();
    expect(py.run).toBe('python "A.py"');
  });
});

describe('shellQuote', () => {
  it('escapes quotes', () => {
    expect(shellQuote("it's", 'linux')).toBe(`'it'\\''s'`);
    expect(shellQuote('say "hi"', 'win32')).toBe('"say ""hi"""');
  });
});
