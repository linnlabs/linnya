import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  ProjectCreateInputSchema,
  ProjectUpdateInputSchema,
  type ProjectSystemRole,
} from '@app/schemas';
import {
  DEFAULT_PROJECT_DESCRIPTION,
  DEFAULT_PROJECT_NAME,
  DEFAULT_PROJECT_SYSTEM_ROLE,
  type ProjectLifecyclePort,
} from '../../../definitions/projectLifecycle';
import { toProjectRecord } from '../functions/projectRecord';
import { assertProjectDeletable, assertProjectNameAvailable } from '../functions/projectRules';
import {
  readProject,
  readProjectByName,
  readDefaultProject,
  readProjects,
  insertProject,
  updateProject,
  deleteProject,
} from '../persistence/projectRecords';

/** 绑定当前 Backend 的数据库；Project 不解析路径，也不创建新的数据库连接。 */
export function createProjectLifecycle(db: Database.Database): ProjectLifecyclePort {
  const insert = db.transaction(
    (name: string, description: string | undefined, systemRole: ProjectSystemRole | null) => {
      const existing = readProjectByName(db, name);
      assertProjectNameAvailable(existing?.deleted_at === null ? existing : undefined);
      // 旧软删除记录的清理和新项目创建属于同一事务；失败时不能只留下清理结果。
      if (existing) deleteProject(db, existing.id);
      const id = uuidv4();
      const now = Date.now();
      insertProject(db, {
        id,
        name,
        description: description || null,
        system_role: systemRole,
        icon: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      return id;
    }
  );

  return {
    create(input) {
      const parsed = ProjectCreateInputSchema.parse(input);
      return insert(parsed.name, parsed.description, null);
    },
    ensureDefault() {
      const row = readDefaultProject(db);
      if (row) return row.id;
      return insert(DEFAULT_PROJECT_NAME, DEFAULT_PROJECT_DESCRIPTION, DEFAULT_PROJECT_SYSTEM_ROLE);
    },
    get: projectId => toProjectRecord(readProject(db, projectId)),
    list: () => readProjects(db).map(toProjectRecord),
    update(projectId, input) {
      const parsed = ProjectUpdateInputSchema.parse(input);
      db.transaction(() => {
        const current = readProject(db, projectId);
        const named = parsed.name === undefined ? undefined : readProjectByName(db, parsed.name);
        assertProjectNameAvailable(named, projectId);
        updateProject(db, {
          ...current,
          name: parsed.name ?? current.name,
          description: parsed.description ?? current.description,
          updated_at: Date.now(),
        });
      })();
    },
    delete(projectId) {
      db.transaction(() => {
        const project = toProjectRecord(readProject(db, projectId));
        assertProjectDeletable(project);
        // 保留现有物理删除合同。Conversation 的解除关联由其 FK 持有，不能宣称完整删除会话。
        deleteProject(db, projectId);
      })();
    },
  };
}
