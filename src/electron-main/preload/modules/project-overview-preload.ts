import type { IpcRenderer } from 'electron';
import {
  PROJECT_OVERVIEW_CHANNEL,
  PROJECT_OVERVIEW_MATCH_CHANNEL,
  PROJECT_OVERVIEW_SET_FIELD_CHANNEL,
  PROJECT_SAVED_FILTERS_CHANNEL,
  SEMANTIC_SCHEMA_MANAGE_CHANNEL,
  type ProjectOverviewMatchRequest,
  type ProjectOverviewRequest,
  type ProjectOverviewSetFieldRequest,
  type ProjectSavedFiltersRequest,
  type SemanticSchemaManageRequest,
} from '@app/schemas';

/** 返回值都未校验；Renderer 必须用对应的 Result Schema 解析。 */
export function buildProjectOverviewPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    readProjectOverview: (request: ProjectOverviewRequest): Promise<unknown> => (
      ipcRenderer.invoke(PROJECT_OVERVIEW_CHANNEL, request)
    ),
    projectSavedFilters: (request: ProjectSavedFiltersRequest): Promise<unknown> => (
      ipcRenderer.invoke(PROJECT_SAVED_FILTERS_CHANNEL, request)
    ),
    matchProjectFields: (request: ProjectOverviewMatchRequest): Promise<unknown> => (
      ipcRenderer.invoke(PROJECT_OVERVIEW_MATCH_CHANNEL, request)
    ),
    setProjectField: (request: ProjectOverviewSetFieldRequest): Promise<unknown> => (
      ipcRenderer.invoke(PROJECT_OVERVIEW_SET_FIELD_CHANNEL, request)
    ),
    manageSemanticSchema: (request: SemanticSchemaManageRequest): Promise<unknown> => (
      ipcRenderer.invoke(SEMANTIC_SCHEMA_MANAGE_CHANNEL, request)
    ),
  };
}
