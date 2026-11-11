import {
  ProjectOverviewMatchResultSchema,
  ProjectOverviewSchema,
  ProjectOverviewSetFieldResultSchema,
  ProjectSavedFiltersResultSchema,
  type ProjectOverview,
  type ProjectOverviewMatchRequest,
  type ProjectOverviewMatchResult,
  type ProjectOverviewRequest,
  type ProjectOverviewSetFieldRequest,
  type ProjectOverviewSetFieldResult,
  type ProjectSavedFiltersRequest,
  type ProjectSavedFiltersResult,
} from '@app/schemas';

/**
 * 请求里常带着界面状态（Vue 响应式代理），IPC 的结构化克隆不接受代理；
 * 这些请求都是纯 JSON 合同，发出前转成普通对象。
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 项目概览的 Backend 读取；返回值在这里按共享合同解析，调用方拿到的一定合法。 */
export async function readProjectOverview(request: ProjectOverviewRequest): Promise<ProjectOverview> {
  const response = await window.electronAPI.readProjectOverview(request);
  return ProjectOverviewSchema.parse(response);
}

/** 保存的筛选：列出、保存、改名、固定、删除、记打开时间；每次都返回整份列表。 */
export async function requestProjectSavedFilters(request: ProjectSavedFiltersRequest): Promise<ProjectSavedFiltersResult> {
  const response = await window.electronAPI.projectSavedFilters(plain(request));
  return ProjectSavedFiltersResultSchema.parse(response);
}

/** 字段条件 → 满足条件的文档 ID。 */
export async function matchProjectFields(request: ProjectOverviewMatchRequest): Promise<ProjectOverviewMatchResult> {
  const response = await window.electronAPI.matchProjectFields(plain(request));
  return ProjectOverviewMatchResultSchema.parse(response);
}

/** 看板拖动改值。 */
export async function setProjectField(request: ProjectOverviewSetFieldRequest): Promise<ProjectOverviewSetFieldResult> {
  const response = await window.electronAPI.setProjectField(plain(request));
  return ProjectOverviewSetFieldResultSchema.parse(response);
}
