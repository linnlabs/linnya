import type Database from 'better-sqlite3';
import type { ProjectMutationPublisher } from '../../../definitions/projectMutationPublisher';
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
import { deleteEmptyProjectRecord } from '../persistence/deleteEmptyProjectRecord';
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
export function createProjectLifecycle(db: Database.Database, publisher?: ProjectMutationPublisher): ProjectLifecyclePort {
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
      const projectId = insert(parsed.name, parsed.description, null);
      // 当前 Host 的独立项目命令在事务返回后发布，失败写入不会触发界面刷新。
      publisher?.publish({ type: 'project.created', mutationId: uuidv4(), projectId });
      return projectId;
    },
    ensureDefault() {
      const row = readDefaultProject(db);
      if (row) return row.id;
      const projectId = insert(DEFAULT_PROJECT_NAME, DEFAULT_PROJECT_DESCRIPTION, DEFAULT_PROJECT_SYSTEM_ROLE);
      publisher?.publish({ type: 'project.created', mutationId: uuidv4(), projectId });
      return projectId;
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
      publisher?.publish({ type: 'project.updated', mutationId: uuidv4(), projectId });
    },
    deleteEmpty(projectId) {
      db.transaction(() => {
        assertProjectDeletable(toProjectRecord(readProject(db, projectId)));
        deleteEmptyProjectRecord(db, projectId);
      })();
      publisher?.publish({ type: 'project.deleted', mutationId: uuidv4(), projectId });
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
