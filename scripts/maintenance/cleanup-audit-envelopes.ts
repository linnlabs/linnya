import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

interface CountRow {
  count: number;
}

function readDbPath(argv: readonly string[]): string {
  const dbArg = argv.find(arg => arg.startsWith('--db='));
  if (dbArg) {
    return path.resolve(dbArg.slice('--db='.length));
  }

  return path.join(process.cwd(), '_dev_data', 'workspace', 'workspace.sqlite');
}

function countAuditEnvelopes(db: Database.Database): number {
  return (db
    .prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'audit_envelope'")
    .get() as CountRow).count;
}

function main(): void {
  const dbPath = readDbPath(process.argv.slice(2));
  if (!fs.existsSync(dbPath)) {
    throw new Error(`workspace sqlite not found: ${dbPath}`);
  }

  const db = new Database(dbPath);
  try {
    const before = countAuditEnvelopes(db);
    const deleted = db
      .prepare("DELETE FROM events WHERE type = 'audit_envelope'")
      .run().changes;

    // 中文备注：删除大 payload 后必须 VACUUM 才会把 SQLite 文件体积还给文件系统。
    db.exec('VACUUM');

    const after = countAuditEnvelopes(db);
    console.log(JSON.stringify({
      dbPath,
      auditEnvelopeCountBefore: before,
      deleted,
      auditEnvelopeCountAfter: after,
      nextStep: '建议继续运行 npm run maintenance:backfill-ui-messages -- --force；本脚本直删 events，绕过了 UI read model 投影钩子。',
    }, null, 2));
  } finally {
    db.close();
  }
}

main();
