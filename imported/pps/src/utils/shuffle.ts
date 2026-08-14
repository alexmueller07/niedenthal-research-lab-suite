// Uniform Fisher-Yates shuffle, returning a new array.
//
// Prefer this over `array.sort(() => Math.random() - 0.5)`, which is *not* a
// uniform shuffle: the comparator is inconsistent, so some orderings are more
// likely than others. For a study that randomizes item order per participant to
// avoid anchoring/order effects, that bias is a data-quality problem.
export function shuffle<T>(array: readonly T[]): T[] {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
