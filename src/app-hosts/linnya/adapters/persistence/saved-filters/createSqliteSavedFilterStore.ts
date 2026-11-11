import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  PROJECT_SAVED_FILTER_SUGGESTION_TTL_MS,
  ProjectSavedFilterDefinitionSchema,
  type ProjectSavedFilter,
  type ProjectSavedFilterDefinition,
} from '@app/schemas';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly origin: 'user' | 'agent';
  readonly pinned: number;
  readonly conversation_id: string | null;
  readonly definition_json: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly last_opened_at: number;
}

export interface SavedFilterCreateInput {
  readonly projectId: string;
  readonly name: string;
  readonly origin: 'user' | 'agent';
  readonly pinned: boolean;
  readonly conversationId: string | null;
  readonly definition: ProjectSavedFilterDefinition;
}

export interface SavedFilterPatch {
  readonly name?: string;
  readonly definition?: ProjectSavedFilterDefinition;
  readonly pinned?: boolean;
}

export class SavedFilterNotFoundError extends Error {
  constructor(id: string) {
    super(`没有这个保存的筛选：${id}`);
  }
}

function toFilter(row: Row): ProjectSavedFilter {
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    pinned: row.pinned === 1,
    conversation_id: row.conversation_id,
    // 读出时按合同校验：以后定义升版本时在这里迁移旧版本。
    definition: ProjectSavedFilterDefinitionSchema.parse(JSON.parse(row.definition_json)),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_opened_at: row.last_opened_at,
  };
}

/**
 * 保存的筛选的 SQLite 存储。固定的按位置排在前，Agent 建议在后；新固定的排到最后。
 * Agent 建议 30 天没打开就在列出时清理（只删条件，文件不受影响）。
 */
export function createSqliteSavedFilterStore(
  db: Database.Database,
  options: { readonly now?: () => number; readonly newId?: () => string } = {},
) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const columns = 'id, name, origin, pinned, conversation_id, definition_json, created_at, updated_at, last_opened_at';

  function nextPosition(projectId: string): number {
    const row = db.prepare<[string], { position: number | null }>(
      'SELECT MAX(position) AS position FROM project_saved_filters WHERE project_id = ?',
    ).get(projectId);
    return (row?.position ?? -1) + 1;
  }

  function read(projectId: string, id: string): ProjectSavedFilter {
    const row = db.prepare<[string, string], Row>(
      `SELECT ${columns} FROM project_saved_filters WHERE project_id = ? AND id = ?`,
    ).get(projectId, id);
    if (!row) throw new SavedFilterNotFoundError(id);
    return toFilter(row);
  }

  return {
    list(projectId: string): ProjectSavedFilter[] {
      db.prepare(`
        DELETE FROM project_saved_filters
        WHERE project_id = ? AND origin = 'agent' AND pinned = 0 AND last_opened_at < ?
      `).run(projectId, now() - PROJECT_SAVED_FILTER_SUGGESTION_TTL_MS);
      return db.prepare<[string], Row>(
        `SELECT ${columns} FROM project_saved_filters WHERE project_id = ? ORDER BY pinned DESC, position, created_at, id`,
      ).all(projectId).map(toFilter);
    },

    read,

    create(input: SavedFilterCreateInput): ProjectSavedFilter {
      const id = newId();
      const at = now();
      db.prepare(`
        INSERT INTO project_saved_filters (id, project_id, name, origin, pinned, position, conversation_id, definition_json, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.projectId, input.name, input.origin, input.pinned ? 1 : 0, nextPosition(input.projectId),
        input.conversationId, JSON.stringify(ProjectSavedFilterDefinitionSchema.parse(input.definition)), at, at, at,
      );
      return read(input.projectId, id);
    },

    update(projectId: string, id: string, patch: SavedFilterPatch): ProjectSavedFilter {
      return db.transaction(() => {
        const current = read(projectId, id);
        const pinning = patch.pinned === true && !current.pinned;
        db.prepare(`
          UPDATE project_saved_filters
          SET name = ?, definition_json = ?, pinned = ?, position = ?, updated_at = ?
          WHERE project_id = ? AND id = ?
        `).run(
          patch.name ?? current.name,
          JSON.stringify(ProjectSavedFilterDefinitionSchema.parse(patch.definition ?? current.definition)),
          (patch.pinned ?? current.pinned) ? 1 : 0,
          // 刚固定的建议排到那一排的最后。
          pinning ? nextPosition(projectId) : db.prepare<[string], { position: number }>(
            'SELECT position FROM project_saved_filters WHERE id = ?',
          ).get(id)?.position ?? 0,
          now(), projectId, id,
        );
        return read(projectId, id);
      })();
    },

    delete(projectId: string, id: string): void {
      const result = db.prepare('DELETE FROM project_saved_filters WHERE project_id = ? AND id = ?').run(projectId, id);
      if (result.changes === 0) throw new SavedFilterNotFoundError(id);
    },

    /** 记下打开时间：Agent 建议按它判断是否 30 天没用过。 */
    markOpened(projectId: string, id: string): void {
      const result = db.prepare('UPDATE project_saved_filters SET last_opened_at = ? WHERE project_id = ? AND id = ?')
        .run(now(), projectId, id);
      if (result.changes === 0) throw new SavedFilterNotFoundError(id);
    },
  };
}

export type SqliteSavedFilterStore = ReturnType<typeof createSqliteSavedFilterStore>;
