import { Language } from '../core/naming';

/**
 * Compatibility with the cph-submit browser add-on (https://github.com/agrawal-d/cph-submit).
 * It polls GET http://localhost:27121/getSubmit every few seconds (header "cph-submit: true");
 * when a submission is waiting it opens Codeforces in the logged-in browser, fills the form and submits.
 */
export const CPH_SUBMIT_PORT = 27121;

export interface CphSubmitPayload {
  empty: false;
  /** Codeforces problem code, e.g. "4A". */
  problemName: string;
  url: string;
  sourceCode: string;
  /** Codeforces compiler id (programTypeId). */
  languageId: number;
}

/** Codeforces compiler ids, same defaults as CPH (C++23, C11, PyPy 3.10, Java 21, Rust 2024, Go, Node.js). */
export const CODEFORCES_LANGUAGE_IDS: Record<Language, number> = {
  cpp: 91,
  c: 43,
  python: 70,
  java: 87,
  rust: 98,
  go: 32,
  js: 55,
};

/** "4A" for https://codeforces.com/contest/4/problem/A and the other Codeforces URL shapes. */
export function codeforcesProblemName(url: string): string | undefined {
  const patterns = [
    /\/contest\/(\d+)\/problem\/(\w+)/,
    /\/gym\/(\d+)\/problem\/(\w+)/,
    /\/problemset\/problem\/(\d+)\/(\w+)/,
    /\/problemset\/gymProblem\/(\d+)\/(\w+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(url);
    if (m) return m[1] + m[2].toUpperCase();
  }
  return undefined;
}

/** Holds at most one submission until cph-submit collects it, or it expires. */
export class CphSubmitQueue {
  private pending: { payload: CphSubmitPayload; done: (taken: boolean) => void; timer: NodeJS.Timeout } | undefined;

  /** Resolves true once cph-submit picks the submission up, false if it doesn't within `timeoutMs`. */
  offer(payload: CphSubmitPayload, timeoutMs: number): Promise<boolean> {
    this.settle(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(false), timeoutMs);
      this.pending = { payload, done: resolve, timer };
    });
  }

  /** Called on GET /getSubmit. Only the add-on (cph-submit header) consumes the submission. */
  take(fromAddOn: boolean): CphSubmitPayload | undefined {
    const payload = this.pending?.payload;
    if (payload && fromAddOn) this.settle(true);
    return payload;
  }

  cancel(): void {
    this.settle(false);
  }

  private settle(taken: boolean): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const { done } = this.pending;
    this.pending = undefined;
    done(taken);
  }
}
