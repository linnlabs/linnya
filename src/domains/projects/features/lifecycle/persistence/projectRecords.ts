import type Database from 'better-sqlite3';
import { ProjectNotFoundError } from '../../../definitions/projectErrors';
import { ProjectRowSchema, type ProjectRow } from '../definitions/projectRow';

const PROJECT_COLUMNS =
  'id, name, description, icon, system_role, created_at, updated_at, deleted_at';

export function readProject(db: Database.Database, projectId: string): ProjectRow {
  const row: unknown = db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? AND deleted_at IS NULL`)
    .get(projectId);
  if (!row) throw new ProjectNotFoundError(projectId);
  return ProjectRowSchema.parse(row);
}

export function readProjectByName(db: Database.Database, name: string): ProjectRow | undefined {
  const row: unknown = db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE name = ?`)
    .get(name);
  return row ? ProjectRowSchema.parse(row) : undefined;
}

export function readDefaultProject(db: Database.Database): ProjectRow | undefined {
  const row: unknown = db
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE system_role = 'default' AND deleted_at IS NULL`
    )
    .get();
  return row ? ProjectRowSchema.parse(row) : undefined;
}

export function readProjects(db: Database.Database): ProjectRow[] {
  const rows: unknown[] = db
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC`
    )
    .all();
  return rows.map(row => ProjectRowSchema.parse(row));
}

export function insertProject(db: Database.Database, project: ProjectRow): void {
  db.prepare(
    'INSERT INTO projects (id, name, description, system_role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    project.id,
    project.name,
    project.description,
    project.system_role,
    project.created_at,
    project.updated_at
  );
}

export function updateProject(db: Database.Database, project: ProjectRow): void {
  db.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
    project.name,
    project.description,
    project.updated_at,
    project.id
  );
}

export function deleteProject(db: Database.Database, projectId: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
}
