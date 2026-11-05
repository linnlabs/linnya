/**
 * @file searchPattern.ts
 * @description Workspace grep 的 literal 匹配、trigram 候选查询与短查询预筛规则。
 */

export interface CompiledWorkspaceSearchPattern {
  readonly raw: string;
  readonly comparable: string;
  readonly caseSensitive: boolean;
  readonly grams: readonly string[];
}

export interface TextLineMatch {
  readonly line: number;
  readonly column: number;
  readonly preview: string;
}

function toCodePoints(value: string): string[] {
  return Array.from(value);
}

export function buildUniqueTrigrams(value: string): string[] {
  const codePoints = toCodePoints(value);
  if (codePoints.length < 3) return [];

  const grams = new Set<string>();
  for (let index = 0; index <= codePoints.length - 3; index += 1) {
    grams.add(codePoints.slice(index, index + 3).join(''));
  }
  return Array.from(grams);
}

/**
 * 把查询的 trigram 组合成 FTS5 MATCH 表达式：候选行必须同时含有这些三字组。
 * 每个三字组作为带引号的字符串传入，避免 FTS5 查询语法（AND/OR/NEAR/*）误解释用户输入。
 */
export function buildTrigramMatchExpression(grams: readonly string[]): string {
  return grams.map((gram) => `"${gram.replace(/"/g, '""')}"`).join(' AND ');
}

/**
 * 不足三字的大小写不敏感查询走 SQL LIKE 预筛。SQLite LIKE 只折叠 ASCII 大小写，
 * 因此为其余字符补齐逐字大小写变体，保证预筛结果覆盖 JS toLowerCase 的命中；
 * 最终是否命中仍由 findLiteralMatchInLine 判断。
 */
export function buildShortPatternCaseVariants(raw: string): string[] {
  let variants = [''];
  for (const char of toCodePoints(raw)) {
    const forms = Array.from(new Set([char, char.toLowerCase(), char.toUpperCase()]));
    variants = variants.flatMap((prefix) => forms.map((form) => prefix + form));
  }
  return Array.from(new Set(variants.map((variant) => variant.replace(/[A-Z]/g, (letter) => letter.toLowerCase()))));
}

export function compileWorkspaceSearchPattern(params: {
  readonly pattern: string;
  readonly caseSensitive?: boolean;
}): CompiledWorkspaceSearchPattern {
  const raw = params.pattern.trim();
  const caseSensitive = params.caseSensitive === true;
  const comparable = caseSensitive ? raw : raw.toLowerCase();
  return {
    raw,
    comparable,
    caseSensitive,
    grams: buildUniqueTrigrams(raw.toLowerCase()),
  };
}

export function findLiteralMatchesInText(params: {
  readonly text: string;
  readonly compiled: CompiledWorkspaceSearchPattern;
  readonly maxMatches: number;
}): TextLineMatch[] {
  const matches: TextLineMatch[] = [];
  const needle = params.compiled.comparable;
  if (!needle || params.maxMatches <= 0) return matches;

  const lines = params.text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const comparableLine = params.compiled.caseSensitive ? line : line.toLowerCase();
    const column = comparableLine.indexOf(needle);
    if (column < 0) continue;
    matches.push({
      line: index + 1,
      column: column + 1,
      preview: line.trim(),
    });
    if (matches.length >= params.maxMatches) break;
  }

  return matches;
}

export function findLiteralMatchInLine(params: {
  readonly text: string;
  readonly compiled: CompiledWorkspaceSearchPattern;
}): TextLineMatch | null {
  const comparableLine = params.compiled.caseSensitive ? params.text : params.text.toLowerCase();
  const column = comparableLine.indexOf(params.compiled.comparable);
  if (column < 0) return null;
  return {
    line: 1,
    column: column + 1,
    preview: params.text.trim(),
  };
}
