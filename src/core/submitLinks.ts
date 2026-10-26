/**
 * Submit pages for judges without a submit API. CP Pilot copies the code and opens the page
 * with the problem preselected; the user pastes and submits in their own logged-in browser.
 */

export interface BrowserSubmitTarget {
  judge: 'Codeforces' | 'AtCoder' | 'CodeChef' | 'USACO';
  submitUrl: string;
  /** "paste": the page has a code box. "upload": it wants the source file (USACO). */
  mode: 'paste' | 'upload';
}

export function browserSubmitTarget(problemUrl: string): BrowserSubmitTarget | undefined {
  let url: URL;
  try {
    url = new URL(problemUrl);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^(www|m[1-3])\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'codeforces.com') {
    // /contest/4/problem/A, /gym/104114/problem/B, /problemset/problem/4/A
    const [section, a, b, c] = parts;
    if ((section === 'contest' || section === 'gym') && b === 'problem' && c) {
      return codeforces(section, a, c);
    }
    if (section === 'problemset' && a === 'problem' && b && c) return codeforces('contest', b, c);
    return undefined;
  }

  if (host === 'atcoder.jp') {
    // /contests/abc300/tasks/abc300_a
    const [section, contest, tasks, task] = parts;
    if (section === 'contests' && tasks === 'tasks' && task) {
      return {
        judge: 'AtCoder',
        mode: 'paste',
        submitUrl: `https://atcoder.jp/contests/${encodeURIComponent(contest)}/submit?taskScreenName=${encodeURIComponent(task)}`,
      };
    }
    return undefined;
  }

  if (host === 'usaco.org') {
    // index.php?page=viewproblem2&cpid=834: when logged in, the problem page itself has the upload form.
    const cpid = url.searchParams.get('cpid');
    if (url.searchParams.get('page') !== 'viewproblem2' || !cpid || !/^\d+$/.test(cpid)) return undefined;
    return { judge: 'USACO', mode: 'upload', submitUrl: `https://usaco.org/index.php?page=viewproblem2&cpid=${cpid}` };
  }

  if (host === 'codechef.com') {
    // /problems/CODE or /START100/problems/CODE
    const i = parts.indexOf('problems');
    const code = i >= 0 ? parts[i + 1] : undefined;
    if (!code) return undefined;
    const contest = i === 1 ? `${encodeURIComponent(parts[0])}/` : '';
    return { judge: 'CodeChef', mode: 'paste', submitUrl: `https://www.codechef.com/${contest}submit/${encodeURIComponent(code)}` };
  }

  return undefined;
}

function codeforces(section: 'contest' | 'gym', contest: string, index: string): BrowserSubmitTarget | undefined {
  if (!/^\d+$/.test(contest)) return undefined;
  return {
    judge: 'Codeforces',
    mode: 'paste',
    submitUrl: `https://codeforces.com/${section}/${contest}/submit?submittedProblemIndex=${encodeURIComponent(index.toUpperCase())}`,
  };
}
