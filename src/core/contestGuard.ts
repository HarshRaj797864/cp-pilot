import { HttpTransport, nodeTransport } from './http';

/**
 * Codeforces and AtCoder restrict AI help during rated rounds, so AI features check whether a
 * problem belongs to a contest that is running right now.
 */
export type ContestStatus =
  | { status: 'practice' }
  | { status: 'live'; contest: string; endsAt?: Date }
  /** Couldn't tell (other judges, network trouble): the caller asks the user. */
  | { status: 'unknown'; judge: string; reason: string };

const CODEFORCES_CACHE_MS = 5 * 60_000;
let codeforcesCache: { at: number; contests: CodeforcesContest[] } | undefined;

interface CodeforcesContest {
  id: number;
  name: string;
  phase: string;
  startTimeSeconds?: number;
  durationSeconds?: number;
}

export async function contestStatus(
  problemUrl: string,
  transport: HttpTransport = nodeTransport,
  now: number = Date.now(),
): Promise<ContestStatus> {
  let url: URL;
  try {
    url = new URL(problemUrl);
  } catch {
    return { status: 'unknown', judge: 'this judge', reason: 'the problem has no URL' };
  }
  const host = url.hostname.replace(/^(www|m[1-3])\./, '');

  // The CSES problem set and USACO's public problem pages are practice archives.
  if (host === 'cses.fi' || host === 'usaco.org') return { status: 'practice' };

  if (host === 'codeforces.com') {
    if (url.pathname.startsWith('/gym/')) return { status: 'practice' };
    const id = /^\/(?:contest|problemset\/problem)\/(\d+)/.exec(url.pathname)?.[1];
    if (!id) return { status: 'unknown', judge: 'Codeforces', reason: "the contest couldn't be identified" };
    return codeforcesStatus(Number(id), transport, now);
  }

  if (host === 'atcoder.jp') {
    const contest = /^\/contests\/([^/]+)/.exec(url.pathname)?.[1];
    if (!contest) return { status: 'unknown', judge: 'AtCoder', reason: "the contest couldn't be identified" };
    return atcoderStatus(contest, transport, now);
  }

  return { status: 'unknown', judge: host, reason: "CP Pilot can't check this judge's contest times" };
}

async function codeforcesStatus(id: number, transport: HttpTransport, now: number): Promise<ContestStatus> {
  let contests = codeforcesCache && now - codeforcesCache.at < CODEFORCES_CACHE_MS ? codeforcesCache.contests : undefined;
  if (!contests) {
    try {
      const res = await transport({ method: 'GET', url: 'https://codeforces.com/api/contest.list?gym=false', timeoutMs: 15_000 });
      const body = JSON.parse(res.text) as { status: string; result?: CodeforcesContest[] };
      if (res.status !== 200 || body.status !== 'OK' || !body.result) throw new Error(`HTTP ${res.status}`);
      contests = body.result;
      codeforcesCache = { at: now, contests };
    } catch {
      return { status: 'unknown', judge: 'Codeforces', reason: "the Codeforces contest list couldn't be loaded" };
    }
  }
  const contest = contests.find((c) => c.id === id);
  if (!contest) return { status: 'unknown', judge: 'Codeforces', reason: `contest ${id} isn't in the contest list` };
  if (contest.phase !== 'CODING') return { status: 'practice' };
  const endsAt =
    contest.startTimeSeconds !== undefined && contest.durationSeconds !== undefined
      ? new Date((contest.startTimeSeconds + contest.durationSeconds) * 1000)
      : undefined;
  return { status: 'live', contest: contest.name, endsAt };
}

async function atcoderStatus(contest: string, transport: HttpTransport, now: number): Promise<ContestStatus> {
  let html: string;
  try {
    const res = await transport({ method: 'GET', url: `https://atcoder.jp/contests/${encodeURIComponent(contest)}`, timeoutMs: 15_000 });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    html = res.text;
  } catch {
    return { status: 'unknown', judge: 'AtCoder', reason: "the contest page couldn't be loaded" };
  }
  const times = parseAtcoderTimes(html);
  if (!times) return { status: 'unknown', judge: 'AtCoder', reason: "the contest times couldn't be read" };
  if (now >= times.start.getTime() && now < times.end.getTime()) {
    return { status: 'live', contest: atcoderTitle(html) ?? contest, endsAt: times.end };
  }
  return { status: 'practice' };
}

/** AtCoder contest pages embed `var startTime = moment("2023-04-29T21:00:00+09:00");` and an endTime. */
export function parseAtcoderTimes(html: string): { start: Date; end: Date } | undefined {
  const start = /var\s+startTime\s*=\s*moment\("([^"]+)"\)/.exec(html)?.[1];
  const end = /var\s+endTime\s*=\s*moment\("([^"]+)"\)/.exec(html)?.[1];
  if (!start || !end) return undefined;
  const s = new Date(start);
  const e = new Date(end);
  return Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) ? undefined : { start: s, end: e };
}

function atcoderTitle(html: string): string | undefined {
  return /<title>([^<]+?)(?:\s+-\s+AtCoder)?<\/title>/.exec(html)?.[1]?.trim();
}

/** For tests. */
export function resetContestCache(): void {
  codeforcesCache = undefined;
}
