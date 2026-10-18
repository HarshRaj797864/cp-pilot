import { describe, expect, it } from 'vitest';
import { javaMainClass, prepareSubmitFile, shortVerdict } from '../src/cses/files';

describe('javaMainClass', () => {
  it.each([
    ['public class Sum { public static void main(String[] a) {} }', 'Sum'],
    ['class Main { public static void main(String[] a) {} }', 'Main'],
    ['class Helper {}\nclass Solution { static void main(String[] a) {} }', 'Solution'],
    ['final public class X {}', 'X'],
    ['public final class Fast { }', 'Fast'],
    ['// public class Commented {}\nclass Real { public static void main(String[] a) {} }', 'Real'],
    ['class A { String s = "public class Fake"; public static void main(String[] a) {} }', 'A'],
    ['import java.util.*;', 'Main'],
  ])('%j -> %s', (src, name) => {
    expect(javaMainClass(src)).toBe(name);
  });
});

describe('prepareSubmitFile', () => {
  it('names Java files after their class', () => {
    expect(prepareSubmitFile('java', '/w/Missing_Number.java', 'class Main { public static void main(String[] a) {} }')).toMatchObject({
      ok: true,
      name: 'Main.java',
    });
  });

  it('keeps other file names', () => {
    expect(prepareSubmitFile('cpp', '/w/Missing_Number.cpp', 'x')).toEqual({ ok: true, name: 'Missing_Number.cpp', content: 'x' });
  });

  it('refuses languages CSES does not have', () => {
    expect(prepareSubmitFile('go', '/w/a.go', 'x')).toMatchObject({ ok: false });
  });
});

describe('shortVerdict', () => {
  it.each([
    ['ACCEPTED', 'AC'],
    ['WRONG ANSWER', 'WA'],
    ['TIME LIMIT EXCEEDED', 'TLE'],
    ['RUNTIME ERROR', 'RE'],
    ['SOMETHING ODD', 'SO'],
  ])('%s -> %s', (v, s) => expect(shortVerdict(v)).toBe(s));
});
