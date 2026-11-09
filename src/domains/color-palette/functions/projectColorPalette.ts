import type { ColorPaletteCheckResult, ColorPaletteSuggestion } from '@app/schemas/color-palette';
import type { PaletteCheckResult, PaletteSuggestion } from '@linnya/color-core/palette';

const SHARE_PRECISION = 100;

/** 跨边界只给 hex 与名称；OKLCH、中性色候选等中间物需要时由调用方用 color-core 从 hex 算。 */
export function projectSuggestion(result: PaletteSuggestion): ColorPaletteSuggestion {
  return {
    id: result.id,
    subject: result.subject.map(color => ({
      hex: color.hex,
      name: color.name,
      share: Math.round(color.share * SHARE_PRECISION) / SHARE_PRECISION,
      images: color.images,
      spot: color.spot,
      pinned: color.pinned,
    })),
    excludedHues: result.excludedHues.map(([from, to]) => [Math.round(from), Math.round(to)]),
    palettes: result.palettes.map(palette => ({
      id: palette.id,
      relation: palette.relation,
      base: palette.base,
      tone: palette.tone,
      bg: palette.bg,
      surface: palette.surface,
      ink: palette.ink,
      muted: palette.muted,
      accent: [...palette.accent],
      chart: [...palette.chart],
    })),
  };
}

export function projectCheckResult(result: PaletteCheckResult): ColorPaletteCheckResult {
  return {
    ok: result.ok,
    findings: result.findings.map(finding => ({
      rule: finding.rule,
      role: finding.role,
      value: finding.value,
      ...(finding.measured === undefined ? {} : { measured: finding.measured }),
      ...(finding.required === undefined ? {} : { required: finding.required }),
    })),
    suggested: result.suggested
      ? { ...result.suggested, accent: [...result.suggested.accent], chart: [...result.suggested.chart] }
      : null,
  };
}
