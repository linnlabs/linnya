import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  WorkspaceDefaultProjectDeleteBlockedError,
  WorkspaceProjectNameConflictError,
  WorkspaceProjectNotFoundError,
} from '../../definitions/workspaceErrors';
import {
  DEFAULT_PROJECT_DESCRIPTION,
  DEFAULT_PROJECT_NAME,
  DEFAULT_PROJECT_SYSTEM_ROLE,
  type ProjectSystemRole,
  type WorkspaceProject,
  type WorkspaceProjectRow,
} from '../definitions/workspaceProject';

function normalizeProjectSystemRole(role: string | null): ProjectSystemRole | null {
  return role === DEFAULT_PROJECT_SYSTEM_ROLE ? DEFAULT_PROJECT_SYSTEM_ROLE : null;
}

function canDeleteProject(row: Pick<WorkspaceProjectRow, 'system_role'>): boolean {
  return normalizeProjectSystemRole(row.system_role) !== DEFAULT_PROJECT_SYSTEM_ROLE;
}

function toWorkspaceProject(row: WorkspaceProjectRow): WorkspaceProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    system_role: normalizeProjectSystemRole(row.system_role),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    can_delete: canDeleteProject(row),
  };
}

function insertWorkspaceProject(params: {
  readonly db: Database.Database;
  readonly name: string;
  readonly description?: string;
  readonly systemRole?: ProjectSystemRole | null;
}): string {
  const now = Date.now();
  const id = uuidv4();
  const existing = params.db.prepare(`
    SELECT id, deleted_at
    FROM projects
    WHERE name = ?
    LIMIT 1
  `).get(params.name) as { id: string; deleted_at: number | null } | undefined;

  if (existing?.deleted_at === null) {
    throw new WorkspaceProjectNameConflictError(params.name);
  }
  if (existing) {
    // 中文说明：历史版本曾软删除项目；当前项目删除是物理删除，因此创建同名项目时
    // 先清理旧行，让数据库唯一约束与当前生命周期语义保持一致。
    params.db.prepare('DELETE FROM projects WHERE id = ?').run(existing.id);
  }

  params.db.prepare(`
    INSERT INTO projects (id, name, description, system_role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.name,
    params.description || null,
    params.systemRole ?? null,
    now,
    now,
  );
  return id;
}

export function createWorkspaceProject(params: {
  readonly db: Database.Database;
  readonly name: string;
  readonly description?: string;
}): string {
  return insertWorkspaceProject(params);
}

export function ensureDefaultWorkspaceProject(db: Database.Database): string {
  const existing = db.prepare(`
    SELECT id
    FROM projects
    WHERE system_role = ? AND deleted_at IS NULL
    LIMIT 1
  `).get(DEFAULT_PROJECT_SYSTEM_ROLE) as { id: string } | undefined;
  if (existing) return existing.id;

  return insertWorkspaceProject({
    db,
    name: DEFAULT_PROJECT_NAME,
    description: DEFAULT_PROJECT_DESCRIPTION,
    systemRole: DEFAULT_PROJECT_SYSTEM_ROLE,
  });
}

export function updateWorkspaceProject(params: {
  readonly db: Database.Database;
  readonly projectId: string;
  readonly updates: { readonly name?: string; readonly description?: string };
}): void {
  const fields: string[] = [];
  const values: Array<string | number | null> = [];

  if (params.updates.name !== undefined) {
    fields.push('name = ?');
    values.push(params.updates.name);
  }
  if (params.updates.description !== undefined) {
    fields.push('description = ?');
    values.push(params.updates.description);
  }
  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(Date.now(), params.projectId);
  params.db.prepare(`
    UPDATE projects
    SET ${fields.join(', ')}
    WHERE id = ?
  `).run(...values);
}

export function listWorkspaceProjects(db: Database.Database): WorkspaceProject[] {
  const rows = db.prepare(`
    SELECT *
    FROM projects
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `).all() as WorkspaceProjectRow[];
  return rows.map(toWorkspaceProject);
}

export function deleteWorkspaceProject(params: {
  readonly db: Database.Database;
  readonly projectId: string;
}): void {
  const transaction = params.db.transaction(() => {
    const project = params.db.prepare(`
      SELECT id, system_role
      FROM projects
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(params.projectId) as Pick<WorkspaceProjectRow, 'id' | 'system_role'> | undefined;
    if (!project) throw new WorkspaceProjectNotFoundError(params.projectId);
    if (!canDeleteProject(project)) {
      throw new WorkspaceDefaultProjectDeleteBlockedError(params.projectId);
    }

    const result = params.db.prepare('DELETE FROM projects WHERE id = ?').run(params.projectId);
    if (result.changes === 0) throw new WorkspaceProjectNotFoundError(params.projectId);
  });
  transaction();
}
