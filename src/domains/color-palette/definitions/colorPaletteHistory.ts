import type { PaletteCombination } from '@linnya/color-core/palette';

/** 一次建议里每套的编号和组合；`use` 凭编号查到组合。 */
export interface IssuedPalette extends PaletteCombination {
  readonly id: string;
}

export interface IssuedSuggestion {
  /** 整组编号（`pl8f2a`），也是随机种子。 */
  readonly id: string;
  /** 这次挑选时用来降权的最近用过；`--rng` 复现这组时原样再用，结果才能逐字节相同。 */
  readonly recent: readonly PaletteCombination[];
  readonly palettes: readonly IssuedPalette[];
}

/**
 * “最近用过”的存取端口。数据归工作区（工作区数据库），不分项目：同一个人在不同项目里也不想连着拿到同一种配色。
 * 只记组合（底色明暗加色系），不记色值和图片。
 */
export interface ColorPaletteHistoryPort {
  /** 最近选用过的组合，由近到远，最多 `PALETTE_RECENT_USE_LIMIT` 个。 */
  readRecentUses(): readonly PaletteCombination[];
  /** 这组编号发出时用的最近用过；没发出过或已清理时为 null。 */
  readIssuedRecent(suggestionId: string): readonly PaletteCombination[] | null;
  /** 记下发出的一组；同一编号再次发出（复现或碰巧同号）时以最新一次为准。 */
  recordSuggestion(suggestion: IssuedSuggestion): void;
  /** 记下选用了哪一套；编号查不到时返回 null，不写入。 */
  recordUse(paletteId: string): IssuedPalette | null;
}
