import type Database from 'better-sqlite3';
import * as z from 'zod';
import { ColorPaletteBaseSchema } from '@app/schemas/color-palette';
import { PALETTE_RECENT_USE_LIMIT, suggestionIdOfPalette, type PaletteCombination } from '@linnya/color-core/palette';
import type { ColorPaletteHistoryPort, IssuedPalette } from '../../definitions/colorPaletteHistory';

/**
 * 留最近 100 组建议。`use` 一般紧跟在建议之后；一次建稿里重试几次也远用不到 100 组。
 * 编号只有 36⁴ 种，留得越多碰巧同号越多：100 组里有两组同号的概率约 0.3%，同号时以最新一次为准。
 */
const ISSUED_SUGGESTION_LIMIT = 100;

const CombinationSchema = z.strictObject({ base: ColorPaletteBaseSchema, families: z.array(z.string()) });
const IssuedPaletteSchema = CombinationSchema.extend({ id: z.string().min(1) });
const RecentJsonSchema = z.array(CombinationSchema);
const PalettesJsonSchema = z.array(IssuedPaletteSchema);
const FamiliesJsonSchema = z.array(z.string());

interface UseRow {
  readonly base: string;
  readonly families_json: string;
}

/** 库里的 JSON 是本仓储写的；读回时仍按 schema 解析，坏行直接报错，不猜。 */
function parseJson<T>(schema: z.ZodType<T>, text: string): T {
  return schema.parse(JSON.parse(text));
}

export function createSqliteColorPaletteHistory(db: Database.Database): ColorPaletteHistoryPort {
  const selectUses = db.prepare<[number], UseRow>(
    'SELECT base, families_json FROM color_palette_uses ORDER BY seq DESC LIMIT ?',
  );
  const selectIssuedRecent = db.prepare<[string], { readonly recent_json: string }>(
    'SELECT recent_json FROM color_palette_suggestions WHERE suggestion_id = ?',
  );
  const selectIssuedPalettes = db.prepare<[string], { readonly palettes_json: string }>(
    'SELECT palettes_json FROM color_palette_suggestions WHERE suggestion_id = ?',
  );
  const insertSuggestion = db.prepare<[string, number, string, string]>(
    'INSERT OR REPLACE INTO color_palette_suggestions (suggestion_id, issued_at, recent_json, palettes_json) VALUES (?, ?, ?, ?)',
  );
  const pruneSuggestions = db.prepare<[number]>(
    'DELETE FROM color_palette_suggestions WHERE seq NOT IN (SELECT seq FROM color_palette_suggestions ORDER BY seq DESC LIMIT ?)',
  );
  // REPLACE 会删掉同编号的旧行再插入新 seq：同一套再选一次就移到最前，不占两个位置。
  const insertUse = db.prepare<[string, string, string, number]>(
    'INSERT OR REPLACE INTO color_palette_uses (palette_id, base, families_json, used_at) VALUES (?, ?, ?, ?)',
  );
  const pruneUses = db.prepare<[number]>(
    'DELETE FROM color_palette_uses WHERE seq NOT IN (SELECT seq FROM color_palette_uses ORDER BY seq DESC LIMIT ?)',
  );

  const recordSuggestion = db.transaction((suggestionId: string, recent: string, palettes: string) => {
    insertSuggestion.run(suggestionId, Date.now(), recent, palettes);
    pruneSuggestions.run(ISSUED_SUGGESTION_LIMIT);
  });
  const recordUse = db.transaction((palette: IssuedPalette) => {
    insertUse.run(palette.id, palette.base, JSON.stringify(palette.families), Date.now());
    pruneUses.run(PALETTE_RECENT_USE_LIMIT);
  });

  return {
    readRecentUses(): readonly PaletteCombination[] {
      return selectUses.all(PALETTE_RECENT_USE_LIMIT).map(row => ({
        base: ColorPaletteBaseSchema.parse(row.base),
        families: parseJson(FamiliesJsonSchema, row.families_json),
      }));
    },
    readIssuedRecent(suggestionId) {
      const row = selectIssuedRecent.get(suggestionId);
      return row ? parseJson(RecentJsonSchema, row.recent_json) : null;
    },
    recordSuggestion(suggestion) {
      recordSuggestion(suggestion.id, JSON.stringify(suggestion.recent), JSON.stringify(suggestion.palettes));
    },
    recordUse(paletteId) {
      const suggestionId = suggestionIdOfPalette(paletteId);
      const row = suggestionId === null ? undefined : selectIssuedPalettes.get(suggestionId);
      const palette = row
        ? parseJson(PalettesJsonSchema, row.palettes_json).find(issued => issued.id === paletteId.trim().toLowerCase())
        : undefined;
      if (!palette) return null;
      recordUse(palette);
      return palette;
    },
  };
}
