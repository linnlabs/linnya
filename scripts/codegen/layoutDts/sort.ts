/**
 * Deterministic, locale-independent ASCII string comparator.
 *
 * Why not `localeCompare`?
 * `String.prototype.localeCompare` is by default *case-insensitive* in many
 * locales (notably en-US under ICU), which means `'compose'` sorts between
 * `'CHART_PRESETS'` and `'DECK_DESIGN'`. That gives non-obvious diffs and
 * tests that pass on one machine and fail on another.
 *
 * ASCII order matches `[...names].sort()` (the JS default for strings),
 * which is what most readers expect when scanning generated d.ts files.
 */
export function compareAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
