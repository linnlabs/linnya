export interface WorkspaceNodeTextSnapshotStatement {
  readonly get: (...params: readonly unknown[]) => unknown;
  readonly run: (...params: readonly unknown[]) => unknown;
}

export interface WorkspaceNodeTextSnapshotDatabase {
  readonly prepare: (sql: string) => unknown;
}

export interface WorkspaceNodeTextSnapshot {
  readonly nodeId: string;
  readonly contentType: string;
  readonly text: string;
  readonly sourcePluginId: string | null;
  readonly sourceNodeType: string | null;
  readonly updatedAt: number;
}

interface WorkspaceNodeTextSnapshotRow {
  readonly node_id: string;
  readonly content_type: string;
  readonly text: string;
  readonly source_plugin_id: string | null;
  readonly source_node_type: string | null;
  readonly updated_at: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isReadStatement(value: unknown): value is Pick<WorkspaceNodeTextSnapshotStatement, 'get'> {
  return isRecord(value) && typeof value.get === 'function';
}

function isWriteStatement(value: unknown): value is Pick<WorkspaceNodeTextSnapshotStatement, 'run'> {
  return isRecord(value) && typeof value.run === 'function';
}

function isSnapshotRow(value: unknown): value is WorkspaceNodeTextSnapshotRow {
  return isRecord(value) &&
    typeof value.node_id === 'string' &&
    typeof value.content_type === 'string' &&
    typeof value.text === 'string' &&
    (typeof value.source_plugin_id === 'string' || value.source_plugin_id === null) &&
    (typeof value.source_node_type === 'string' || value.source_node_type === null) &&
    typeof value.updated_at === 'number';
}

function toSnapshot(row: WorkspaceNodeTextSnapshotRow): WorkspaceNodeTextSnapshot {
  return {
    nodeId: row.node_id,
    contentType: row.content_type,
    text: row.text,
    sourcePluginId: row.source_plugin_id,
    sourceNodeType: row.source_node_type,
    updatedAt: row.updated_at,
  };
}

export function saveWorkspaceNodeTextSnapshot(params: {
  readonly db: WorkspaceNodeTextSnapshotDatabase;
  readonly nodeId: string;
  readonly contentType: string;
  readonly text: string;
  readonly sourcePluginId?: string | null;
  readonly sourceNodeType?: string | null;
  readonly updatedAt?: number;
}): void {
  const updatedAt = params.updatedAt ?? Date.now();
  const statement = params.db.prepare(`
    INSERT INTO workspace_node_text_snapshots (
      node_id,
      content_type,
      text,
      source_plugin_id,
      source_node_type,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      content_type = excluded.content_type,
      text = excluded.text,
      source_plugin_id = excluded.source_plugin_id,
      source_node_type = excluded.source_node_type,
      updated_at = excluded.updated_at
  `);
  if (!isWriteStatement(statement)) {
    throw new Error('Workspace 节点文本快照写入语句缺少 run 能力。');
  }
  statement.run(
    params.nodeId,
    params.contentType,
    params.text,
    params.sourcePluginId ?? null,
    params.sourceNodeType ?? null,
    updatedAt,
  );
}

export function readWorkspaceNodeTextSnapshot(
  db: WorkspaceNodeTextSnapshotDatabase,
  nodeId: string
): WorkspaceNodeTextSnapshot | null {
  const statement = db.prepare(`
    SELECT
      node_id,
      content_type,
      text,
      source_plugin_id,
      source_node_type,
      updated_at
    FROM workspace_node_text_snapshots
    WHERE node_id = ?
    LIMIT 1
  `);
  if (!isReadStatement(statement)) {
    throw new Error('Workspace 节点文本快照读取语句缺少 get 能力。');
  }
  const row = statement.get(nodeId);
  if (row === undefined) return null;
  if (!isSnapshotRow(row)) {
    throw new Error(`Workspace 节点文本快照结构异常：${nodeId}`);
  }
  return toSnapshot(row);
}

export function hasWorkspaceNodeTextSnapshot(
  db: WorkspaceNodeTextSnapshotDatabase,
  nodeId: string
): boolean {
  return readWorkspaceNodeTextSnapshot(db, nodeId) !== null;
}
