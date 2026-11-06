import type Database from 'better-sqlite3';

/**
 * 受管内容的固定目录结构。迁移只截取这段后缀，不依赖旧的绝对前缀：数据目录换过位置、
 * 或开发数据在 checkout 之间复制过的库同样能转换。分隔符兼容 Windows 写入的反斜杠。
 */
const MANAGED_CONTENT_SUFFIX = new RegExp(
  String.raw`(?:^|[\\/])(ConversationAttachments[\\/]v2[\\/]stores[\\/]` +
    String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` +
    String.raw`[\\/]content[\\/][a-f0-9]{2}[\\/][a-f0-9]{64}\.(?:jpg|png|webp|svg))$`
);

interface AssetLocalPathRow {
  readonly id: string;
  readonly local_path: string;
}

/**
 * v70→v71：`assets.local_path` 改存相对 AppData Root 的持久路径。
 *
 * 绝对路径把数据库绑死在一台机器的一个目录上；改为相对路径后，读取、回收时由当前 AppData Root
 * 现场解析。不符合受管内容结构的行（旧 v1 布局或任意位置）让迁移失败并回滚：
 * 2026-11 各开发库共 5,514 行全部符合，正式版换数据目录后不会打开旧库。
 */
export function migrateV70ToV71AssetRelativeLocalPaths(db: Database.Database): void {
  const rows = db
    .prepare<[], AssetLocalPathRow>(
      'SELECT id, local_path FROM assets WHERE local_path IS NOT NULL ORDER BY id'
    )
    .all();
  const update = db.prepare('UPDATE assets SET local_path = ? WHERE id = ?');
  for (const row of rows) {
    const match = MANAGED_CONTENT_SUFFIX.exec(row.local_path);
    if (!match?.[1]) {
      throw new Error(`v71 无法识别 assets.local_path，不在受管内容目录内：asset ${row.id}`);
    }
    update.run(match[1].replace(/\\/g, '/'), row.id);
  }
}
