import type Database from 'better-sqlite3';
import type { ProjectSavedFiltersRequest, ProjectSavedFiltersResult } from '@app/schemas';
import { createSqliteSavedFilterStore } from '../../../adapters/persistence/saved-filters';

/**
 * 界面上的保存、改名、固定、删除与打开。界面保存的都算用户的，直接固定；
 * 条件相同时提示复用由界面在保存前判断（`projectSavedFilterConditionKey`），用户坚持时照样保存。
 */
export function handleProjectSavedFilters(
  db: Database.Database,
  request: ProjectSavedFiltersRequest,
): ProjectSavedFiltersResult {
  const store = createSqliteSavedFilterStore(db);
  const projectId = request.project_id;
  let savedId: string | null = null;
  switch (request.action) {
    case 'list':
      break;
    case 'create':
      savedId = store.create({
        projectId, name: request.name, origin: 'user', pinned: true, conversationId: null, definition: request.definition,
      }).id;
      break;
    case 'update':
      savedId = store.update(projectId, request.id, {
        ...(request.name === undefined ? {} : { name: request.name }),
        ...(request.definition === undefined ? {} : { definition: request.definition }),
        ...(request.pinned === undefined ? {} : { pinned: request.pinned }),
      }).id;
      break;
    case 'delete':
      store.delete(projectId, request.id);
      break;
    case 'open':
      store.markOpened(projectId, request.id);
      break;
  }
  return { filters: store.list(projectId), saved_id: savedId };
}
