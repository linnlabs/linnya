import {
  MATH_FORMULA_PROFILE_VERSION,
  type MathFormulaAlign,
  type MathFormulaSource,
} from '../definitions/mathFormula';

export interface MathFormulaAuthoringInput {
  readonly latex: string;
  readonly fontSize?: number;
  readonly color?: string;
  readonly align?: MathFormulaAlign;
  readonly altText?: string;
}

export type MathFormulaSourceResult =
  | { readonly value: MathFormulaSource }
  | { readonly error: string };

const MAX_LATEX_CHARACTERS = 4_096;

export function normalizeMathFormulaSource(
  input: MathFormulaAuthoringInput,
  display: MathFormulaSource['display'] = 'block',
): MathFormulaSourceResult {
  if (typeof input.latex !== 'string') {
    return { error: 'Formula.latex 必须是字符串。' };
  }
  const latex = stripOneOuterDelimiter(input.latex.trim());
  if (latex.length === 0) return { error: 'Formula.latex 不能为空。' };
  if (latex.length > MAX_LATEX_CHARACTERS) {
    return { error: `Formula.latex 不能超过 ${MAX_LATEX_CHARACTERS} 个字符。` };
  }
  const fontSize = input.fontSize ?? 28;
  if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 400) {
    return { error: 'Formula.fontSize 必须是 0–400 pt 内的有限正数。' };
  }
  const color = normalizeHexColor(input.color ?? '#000000');
  if (color == null) return { error: 'Formula.color 必须是 #RRGGBB 颜色。' };
  const align = input.align ?? 'center';
  if (align !== 'left' && align !== 'center' && align !== 'right') {
    return { error: 'Formula.align 必须是 left / center / right。' };
  }
  const altText = input.altText?.trim() || '数学公式';
  return {
    value: {
      latex,
      display,
      profileVersion: MATH_FORMULA_PROFILE_VERSION,
      fontSize,
      color,
      align,
      altText,
    },
  };
}

/** Worker / persistence 边界使用的 canonical FormulaSource admission。 */
export function isMathFormulaSource(value: unknown): value is MathFormulaSource {
  if (
    !isRecord(value)
    || typeof value.latex !== 'string'
    || (value.display !== 'block' && value.display !== 'inline')
    || typeof value.fontSize !== 'number'
    || typeof value.color !== 'string'
    || (value.align !== 'left' && value.align !== 'center' && value.align !== 'right')
    || typeof value.altText !== 'string'
  ) {
    return false;
  }
  const normalized = normalizeMathFormulaSource({
    latex: value.latex,
    fontSize: value.fontSize,
    color: value.color,
    align: value.align,
    altText: value.altText,
  }, value.display);
  if ('error' in normalized) return false;
  const source = normalized.value;
  return value.profileVersion === source.profileVersion
    && value.latex === source.latex
    && value.fontSize === source.fontSize
    && value.color === source.color
    && value.align === source.align
    && value.altText === source.altText
    && (value.sourceSpan === undefined || isSourceSpan(value.sourceSpan));
}

function stripOneOuterDelimiter(value: string): string {
  const pairs: readonly [string, string][] = [
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['$', '$'],
  ];
  for (const [start, end] of pairs) {
    if (value.startsWith(start) && value.endsWith(end) && value.length > start.length + end.length) {
      return value.slice(start.length, -end.length).trim();
    }
  }
  return value;
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSourceSpan(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.startLine)
    && typeof value.startLine === 'number'
    && value.startLine >= 1
    && Number.isInteger(value.endLine)
    && typeof value.endLine === 'number'
    && value.endLine >= value.startLine;
}
