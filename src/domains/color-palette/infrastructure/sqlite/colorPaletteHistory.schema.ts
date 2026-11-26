/**
 * 配色“最近用过”的两张表，都在工作区数据库里，删除工作区即删除；不分项目。
 *
 * - `color_palette_suggestions`：发出过的建议。`palette use <编号>` 只拿到编号，要靠它查出那套的组合；
 *   `recent_json` 存当时用来降权的最近用过，`--rng` 复现时原样再用。只留最近若干组，见仓储里的上限。
 * - `color_palette_uses`：选用记录，只存组合（底色明暗与色系名），不存色值和图片。同一套再选一次移到最前，
 *   只留降权要看的最近 15 次。
 *
 * 两张表都用自增 `seq` 表示先后：同一毫秒内的几次调用也能排出顺序；时间列只供排查。
 */
export const COLOR_PALETTE_HISTORY_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS color_palette_suggestions (
    seq INTEGER PRIMARY KEY,
    suggestion_id TEXT NOT NULL UNIQUE,
    issued_at INTEGER NOT NULL,
    recent_json TEXT NOT NULL,
    palettes_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS color_palette_uses (
    seq INTEGER PRIMARY KEY,
    palette_id TEXT NOT NULL UNIQUE,
    base TEXT NOT NULL,
    families_json TEXT NOT NULL,
    used_at INTEGER NOT NULL
  )`,
] as const;
