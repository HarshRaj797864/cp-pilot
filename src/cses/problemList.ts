/** CSES problem set as shown in the sidebar: categories of tasks with the user's status. */

export type ProblemStatus = 'solved' | 'attempted' | 'none';

export interface CsesProblem {
  id: string;
  name: string;
  url: string;
  status: ProblemStatus;
}

export interface CsesCategory {
  name: string;
  problems: CsesProblem[];
}

/** Raw shape of GET /courses/problemset/list. */
export interface RawCourseContent {
  sections: {
    header: string;
    list: { item_type: string; name: string; id?: string; link: string; status?: string }[];
  }[];
}

export function parseProblemList(raw: RawCourseContent): CsesCategory[] {
  return raw.sections
    .map((section) => ({
      name: section.header,
      problems: section.list
        .filter((item) => item.item_type === 'task' && item.id)
        .map((item) => ({ id: item.id!, name: item.name, url: item.link, status: toStatus(item.status) })),
    }))
    .filter((category) => category.problems.length > 0);
}

function toStatus(status: string | undefined): ProblemStatus {
  if (status === 'pass') return 'solved';
  if (status === 'fail') return 'attempted';
  return 'none';
}

export function countSolved(problems: CsesProblem[]): number {
  return problems.filter((p) => p.status === 'solved').length;
}

export interface ListFilter {
  /** Case-insensitive substring of the name, or an exact task id. */
  query: string;
  hideSolved: boolean;
}

/** Applies search and hide-solved, dropping categories left empty. Counts stay based on the full category. */
export function filterProblems(categories: CsesCategory[], filter: ListFilter): CsesCategory[] {
  const query = filter.query.trim().toLowerCase();
  return categories
    .map((category) => ({
      name: category.name,
      problems: category.problems.filter(
        (p) =>
          !(filter.hideSolved && p.status === 'solved') &&
          (!query || p.name.toLowerCase().includes(query) || p.id === query),
      ),
    }))
    .filter((category) => category.problems.length > 0);
}

/** Returns a copy with one problem's status changed, e.g. right after an accepted submission. */
export function withStatus(categories: CsesCategory[], id: string, status: ProblemStatus): CsesCategory[] {
  return categories.map((category) => ({
    name: category.name,
    problems: category.problems.map((p) => (p.id === id ? { ...p, status } : p)),
  }));
}
