import type Database from 'better-sqlite3';

/** 旧图片没有题注；不能把历史文件名 alt 当成用户写的题注。 */
export function migrateV67ToV68MarkdownImageCaption(db: Database.Database): void {
  db.exec("ALTER TABLE image_blocks ADD COLUMN caption TEXT NOT NULL DEFAULT ''");
}
