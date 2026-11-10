import type {
  ColorPalette,
  ColorPaletteBase,
  ColorPaletteCheckResult,
  ColorPaletteDraft,
  ColorPaletteFinding,
  ColorPaletteRelation,
  ColorPaletteSubject,
  ColorPaletteSuggestion,
} from '@app/schemas/color-palette';
import { hueRangeLabel, paletteFamilies } from '@linnya/color-core/palette';

const RELATION_NAMES: Readonly<Record<ColorPaletteRelation, string>> = {
  mono: '同色系', ink: '灰+主色', analog: '邻近色', medium: '中差色', contrast: '对照色', multi: '多色',
};
const BASE_NAMES: Readonly<Record<ColorPaletteBase, string>> = { light: '浅底', tint: '染纸', dark: '深底' };

function subjectLabel(color: ColorPaletteSubject): string {
  const name = `${color.name}${color.hex}`;
  if (color.pinned) return `${name}(指定)`;
  if (color.images === 0) return name;
  return `${name}(${Math.round(color.share * 100)}%,${color.images}图${color.spot ? ',点缀' : ''})`;
}

function roles(palette: ColorPaletteDraft): string {
  return `bg${palette.bg} sf${palette.surface} ink${palette.ink} mu${palette.muted} ac${palette.accent.join(',')} ch${palette.chart.join(',')}`;
}

function paletteLine(palette: ColorPalette): string {
  const families = paletteFamilies(palette);
  const style = [RELATION_NAMES[palette.relation], BASE_NAMES[palette.base], families.length > 0 ? families.join('+') : '无彩'].join('·');
  return `${palette.id} ${style} ${roles(palette)}`;
}

/** 给模型读的紧凑文本：首行是取色结论，之后一行一套。 */
export function formatPaletteSuggestion(input: {
  readonly suggestion: ColorPaletteSuggestion;
  readonly skippedImages: readonly string[];
  readonly preview: string | null;
}): string {
  const { suggestion, skippedImages, preview } = input;
  const summary = [
    `本色 ${suggestion.subject.map(subjectLabel).join(' ')}`,
    ...(suggestion.excludedHues.length > 0
      ? [`排除 ${suggestion.excludedHues.map(([from, to]) => hueRangeLabel(from, to)).join(' ')}`]
      : []),
    ...(skippedImages.length > 0 ? [`读不出 ${skippedImages.join(' ')}`] : []),
  ].join(' | ');
  return [
    summary,
    ...suggestion.palettes.map(paletteLine),
    ...(preview ? [`预览 ${preview}（从上到下对应各套）`] : []),
  ].join('\n') + '\n';
}

function findingLine(finding: ColorPaletteFinding): string {
  if (finding.rule === 'chart_order') return `${finding.rule} ${finding.role}`;
  const contrast = finding.measured === undefined ? '' : ` ${finding.measured}<${finding.required}`;
  return `${finding.rule} ${finding.role} ${finding.value}${contrast}`;
}

export function formatPaletteCheck(result: ColorPaletteCheckResult): string {
  if (result.ok) return '通过\n';
  return [
    `不合格 ${result.findings.length} 项`,
    ...result.findings.map(findingLine),
    result.suggested ? `建议 ${roles(result.suggested)}` : '无法自动修复，需要换一组颜色',
  ].join('\n') + '\n';
}
