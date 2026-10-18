import { CsesApi, CsesLanguage, CsesSubmission } from './api';

const MAX_WAIT_MS = 10 * 60_000;
const MIN_POLL_INTERVAL_MS = 1000;

export class SubmissionTimeoutError extends Error {}

/**
 * Submits a file and follows grading until a final verdict, reporting every update.
 * Uses CSES long polling, but never polls faster than once a second in case the server answers immediately.
 */
export async function submitAndWait(opts: {
  api: CsesApi;
  token: string;
  taskId: string;
  file: { name: string; content: string };
  language: CsesLanguage;
  onUpdate: (submission: CsesSubmission) => void;
  signal?: AbortSignal;
  maxWaitMs?: number;
  minPollIntervalMs?: number;
}): Promise<CsesSubmission> {
  const maxWait = opts.maxWaitMs ?? MAX_WAIT_MS;
  const minInterval = opts.minPollIntervalMs ?? MIN_POLL_INTERVAL_MS;
  const start = Date.now();

  let submission = await opts.api.submit(opts.token, opts.taskId, opts.file, opts.language);
  opts.onUpdate(submission);

  while (submission.pending) {
    if (Date.now() - start > maxWait) {
      throw new SubmissionTimeoutError('CSES is taking unusually long to grade this submission');
    }
    const polled = Date.now();
    submission = await opts.api.getSubmission(opts.token, submission.id, true, opts.signal);
    opts.onUpdate(submission);
    const elapsed = Date.now() - polled;
    if (submission.pending && elapsed < minInterval) await sleep(minInterval - elapsed, opts.signal);
  }
  return submission;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
