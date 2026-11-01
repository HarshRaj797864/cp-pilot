/** Preferred Copilot model families, best first; any other model Copilot offers comes after these. */
const PREFERRED_FAMILIES = ['claude-sonnet', 'gpt-5', 'claude', 'gpt-4.1', 'gpt-4o'];

/**
 * Orders models for trying: the last one that worked, then the user's preferred family, then the
 * built-in preferences, then everything else as Copilot listed it.
 */
export function orderModels<M extends { id: string; family: string }>(models: M[], preferredFamily: string, lastWorkingId?: string): M[] {
  const families = [preferredFamily, ...PREFERRED_FAMILIES].filter(Boolean).map((f) => f.toLowerCase());
  const rank = (m: M) => {
    if (m.id === lastWorkingId) return -1;
    const i = families.findIndex((f) => m.family.toLowerCase().includes(f));
    return i === -1 ? families.length : i;
  };
  return models
    .map((m, index) => ({ m, index }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.index - b.index)
    .map(({ m }) => m);
}
