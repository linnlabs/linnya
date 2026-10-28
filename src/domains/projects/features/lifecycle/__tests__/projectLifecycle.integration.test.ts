import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_SYSTEM_ROLE,
  createProjectLifecycle,
  DefaultProjectDeleteBlockedError,
  PROJECT_SCHEMAS,
  ProjectNameConflictError,
  ProjectNotFoundError,
} from 'src/domains/projects';

function createProjectsSchema(db: Database.Database): void {
  PROJECT_SCHEMAS.forEach(sql => db.exec(sql));
}

describe('Project lifecycle', () => {
  it('manages multiple projects in one database without changing another data workspace', () => {
    const first = new Database(':memory:');
    const second = new Database(':memory:');
    createProjectsSchema(first);
    createProjectsSchema(second);
    const projects = createProjectLifecycle(first);
    const otherWorkspaceProjects = createProjectLifecycle(second);
    const a = projects.create({ name: ' Alpha ', description: 'First' });
    const b = projects.create({ name: 'Beta' });
    otherWorkspaceProjects.create({ name: 'Alpha' });
    projects.update(a, { name: 'Renamed', description: '' });
    expect(projects.get(a)).toMatchObject({ id: a, name: 'Renamed', description: '' });
    expect(projects.get(b).name).toBe('Beta');
    expect(otherWorkspaceProjects.list().map(project => project.name)).toEqual(['Alpha']);
    projects.delete(a);
    expect(projects.list().map(project => project.id)).toEqual([b]);
    expect(otherWorkspaceProjects.list()).toHaveLength(1);
    first.close();
    second.close();
  });

  it('rejects invalid or conflicting mutations without changing the existing project', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const projects = createProjectLifecycle(db);
    const a = projects.create({ name: 'Alpha', description: 'Keep' });
    projects.create({ name: 'Beta' });
    const original = projects.get(a);
    expect(() => projects.create({ name: '  ' })).toThrow();
    expect(() => projects.create({ name: ' Alpha ' })).toThrow(ProjectNameConflictError);
    expect(() => projects.update(a, { name: 'Beta', description: 'Changed' })).toThrow(
      ProjectNameConflictError
    );
    expect(() => projects.update(a, {})).toThrow();
    expect(() => projects.update('missing', { name: 'New' })).toThrow(ProjectNotFoundError);
    expect(projects.get(a)).toEqual(original);
    expect(projects.list()).toHaveLength(2);
    db.close();
  });

  it('rolls back legacy name cleanup when replacement creation fails', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const projects = createProjectLifecycle(db);
    const id = projects.create({ name: 'Legacy' });
    db.prepare('UPDATE projects SET deleted_at = 1 WHERE id = ?').run(id);
    db.exec(
      "CREATE TRIGGER reject_replacement BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
    );
    expect(() => projects.create({ name: 'Legacy' })).toThrow('injected failure');
    expect(db.prepare('SELECT id FROM projects WHERE id = ?').get(id)).toEqual({ id });
    db.exec('DROP TRIGGER reject_replacement');
    const replacement = projects.create({ name: 'Legacy' });
    expect(replacement).not.toBe(id);
    expect(projects.get(replacement).name).toBe('Legacy');
    db.close();
  });
  it('creates default project with stable system role and non-delete capability', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const service = createProjectLifecycle(db);

    const projectId = service.ensureDefault();
    const project = service.list().find(item => item.id === projectId);

    expect(project).toMatchObject({
      name: '默认项目',
      system_role: DEFAULT_PROJECT_SYSTEM_ROLE,
      can_delete: false,
    });

    expect(service.ensureDefault()).toBe(projectId);

    db.close();
  });

  it('keeps renamed default project protected because identity is not name-based', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const service = createProjectLifecycle(db);

    const projectId = service.ensureDefault();
    service.update(projectId, { name: '我的起始项目' });

    const project = service.list().find(item => item.id === projectId);
    expect(project).toMatchObject({
      name: '我的起始项目',
      system_role: DEFAULT_PROJECT_SYSTEM_ROLE,
      can_delete: false,
    });
    expect(() => service.delete(projectId)).toThrow(DefaultProjectDeleteBlockedError);

    expect(service.list().some(item => item.id === projectId)).toBe(true);

    db.close();
  });

  it('deletes ordinary projects', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const service = createProjectLifecycle(db);

    const projectId = service.create({ name: '普通项目', description: '可删除' });
    expect(service.list().find(item => item.id === projectId)).toMatchObject({
      can_delete: true,
      system_role: null,
    });

    service.delete(projectId);

    expect(service.list().some(item => item.id === projectId)).toBe(false);

    db.close();
  });
});
