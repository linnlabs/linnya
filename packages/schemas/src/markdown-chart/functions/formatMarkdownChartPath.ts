import type { MarkdownChartPathSegment } from '../definitions/markdownChartDiagnostic';

/** `['series', 1, 'values']` → `series[1].values`；根对象为 `$`。 */
export function formatMarkdownChartPath(path: readonly MarkdownChartPathSegment[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((text, segment, index) => {
    if (typeof segment === 'number') return `${text}[${segment}]`;
    return index === 0 ? segment : `${text}.${segment}`;
  }, '');
}
