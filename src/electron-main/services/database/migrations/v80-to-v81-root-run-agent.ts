import type Database from 'better-sqlite3';

const MAX_RUN_DEPTH = 64;

function addColumnIfMissing(db: Database.Database, table: string, column: string): void {
  const exists = db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
}

/**
 * 子运行的改动要显示“XX 的子任务”，需要发起它的 Agent，也就是根运行的 Agent。
 * 对话删除会级联删掉运行记录，读取时也不能跨 owner 查运行表，所以账本和语义层在登记时把根运行 Agent 存下来；
 * 这一步给三张表补列，并回填能确定的历史行。
 *
 * 回填只用能证明是同一事实的来源，确定不了的留空，界面退回显示“子任务”。这是真实存在的历史数据：
 * 运行记录已随对话删除的、标签不记运行编号的，都查不回发起它的 Agent。
 *
 * 只加列和回填空值，不改已有值；中途失败随本步事务回滚，重跑时从空值继续，可重入。
 * 新建库的表由 provider 按当前 DDL 建好（已带这些列），这里只做回填。
 */
export function migrateV80ToV81RootRunAgent(db: Database.Database): void {
  addColumnIfMissing(db, 'action_ledger_entries', 'root_agent_id');
  addColumnIfMissing(db, 'semantic_tags', 'created_root_agent_id');
  addColumnIfMissing(db, 'semantic_schema_changes', 'root_agent_id');

  // 账本每条运行记录都带根运行编号。先查仍在的运行记录；运行已随对话删除时，
  // 根运行自己的账本行登记时已记下它的 Agent（v75→v76 起），是同一事实。
  db.exec(`
    UPDATE action_ledger_entries AS entry
    SET root_agent_id = COALESCE(
      (SELECT runs.agent_spec_id FROM runs WHERE runs.id = entry.root_run_id),
      (SELECT root.agent_id FROM action_ledger_entries AS root
        WHERE root.root_run_id = entry.root_run_id AND root.run_id = entry.root_run_id AND root.agent_id IS NOT NULL
        LIMIT 1)
    )
    WHERE entry.root_run_id IS NOT NULL AND entry.root_agent_id IS NULL
  `);

  // 主运行自己就是根运行。
  db.exec(`
    UPDATE semantic_tags SET created_root_agent_id = created_agent_id
    WHERE created_by_kind = 'run' AND created_root_agent_id IS NULL
  `);
  db.exec(`
    UPDATE semantic_schema_changes SET root_agent_id = agent_id
    WHERE actor_kind = 'run' AND root_agent_id IS NULL
  `);

  // 语义层改动批次只记运行编号，不记根运行：子运行沿运行记录的父运行链找到根。链条中断说明中间的运行已删除，留空。
  const parentOf = db.prepare<[string], { parent_run_id: string | null; agent_spec_id: string | null }>(
    'SELECT parent_run_id, agent_spec_id FROM runs WHERE id = ?',
  );
  const update = db.prepare<[string | null, string]>('UPDATE semantic_schema_changes SET root_agent_id = ? WHERE id = ?');
  const pending = db.prepare<[], { id: string; run_id: string }>(`
    SELECT id, run_id FROM semantic_schema_changes
    WHERE actor_kind <> 'run' AND run_id IS NOT NULL AND root_agent_id IS NULL
  `).all();
  for (const change of pending) {
    let run = parentOf.get(change.run_id);
    for (let depth = 0; run?.parent_run_id && depth < MAX_RUN_DEPTH; depth += 1) run = parentOf.get(run.parent_run_id);
    if (run && run.parent_run_id === null) update.run(run.agent_spec_id, change.id);
  }
}
