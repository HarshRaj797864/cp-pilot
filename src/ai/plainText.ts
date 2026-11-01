import { Diagnosis } from './schemas';

const SYMBOLS: Record<string, string> = {
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  cdot: '·',
  times: '×',
  dots: '…',
  ldots: '…',
  cdots: '…',
  to: '→',
  rightarrow: '→',
  infty: '∞',
  sum: 'Σ',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  oplus: '⊕',
  pmod: 'mod',
  bmod: 'mod',
  mod: 'mod',
};

/**
 * Models sometimes answer with LaTeX ("$n(n+1)/2$", "\le") even when asked not to; the panel shows
 * plain text, so turn it into something readable: drop $ delimiters, map common commands to symbols.
 */
export function plainMath(text: string): string {
  return text
    .replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_m, block?: string, inline?: string) => (block ?? inline ?? '').trim())
    .replace(/\\(?:text|mathrm|mathit|mathbf|operatorname)\{([^}]*)\}/g, '$1')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\([A-Za-z]+)/g, (m, name: string) => SYMBOLS[name] ?? m)
    .replace(/\\[,;! ]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

export function plainDiagnosis(d: Diagnosis): Diagnosis {
  return {
    ...d,
    summary: plainMath(d.summary),
    cause: plainMath(d.cause),
    hint: plainMath(d.hint),
    lines: d.lines.map((l) => ({ ...l, why: plainMath(l.why) })),
  };
}
