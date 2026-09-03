import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_SYSTEM_ROLE,
  WorkspaceService,
} from '../workspace';
import { WorkspaceDefaultProjectDeleteBlockedError } from '../../../../features/workspace/definitions/workspaceErrors';

function createProjectsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      icon TEXT,
      system_role TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata_json TEXT,
      deleted_at INTEGER
    );

    CREATE UNIQUE INDEX idx_projects_active_system_role_unique
    ON projects(system_role)
    WHERE deleted_at IS NULL AND system_role IS NOT NULL;
  `);
}

describe('WorkspaceService project system roles', () => {
  it('creates default project with stable system role and non-delete capability', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const service = new WorkspaceService(db);

    const projectId = service.ensureDefaultProject();
    const project = service.getAllProjects().find((item) => item.id === projectId);

    expect(project).toMatchObject({
      name: '默认项目',
      system_role: DEFAULT_PROJECT_SYSTEM_ROLE,
      can_delete: false,
    });

    expect(service.ensureDefaultProject()).toBe(projectId);

    db.close();
  });

  it('keeps renamed default project protected because identity is not name-based', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const service = new WorkspaceService(db);

    const projectId = service.ensureDefaultProject();
    service.updateProject(projectId, { name: '我的起始项目' });

    const project = service.getAllProjects().find((item) => item.id === projectId);
    expect(project).toMatchObject({
      name: '我的起始项目',
      system_role: DEFAULT_PROJECT_SYSTEM_ROLE,
      can_delete: false,
    });
    expect(() => service.deleteProject(projectId)).toThrow(WorkspaceDefaultProjectDeleteBlockedError);

    expect(service.getAllProjects().some((item) => item.id === projectId)).toBe(true);

    db.close();
  });

  it('deletes ordinary projects', () => {
    const db = new Database(':memory:');
    createProjectsSchema(db);
    const service = new WorkspaceService(db);

    const projectId = service.createProject('普通项目', '可删除');
    expect(service.getAllProjects().find((item) => item.id === projectId)).toMatchObject({
      can_delete: true,
      system_role: null,
    });

    service.deleteProject(projectId);

    expect(service.getAllProjects().some((item) => item.id === projectId)).toBe(false);

    db.close();
  });
});
