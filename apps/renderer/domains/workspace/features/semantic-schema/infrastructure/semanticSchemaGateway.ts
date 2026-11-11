import {
  SemanticSchemaManageResultSchema,
  type SemanticSchemaManageRequest,
  type SemanticSchemaManageResult,
} from '@app/schemas';

/** 标签管理的 Backend 请求；返回值按共享合同解析。请求转成普通对象（界面状态可能是响应式代理）。 */
export async function manageSemanticSchema(request: SemanticSchemaManageRequest): Promise<SemanticSchemaManageResult> {
  const response = await window.electronAPI.manageSemanticSchema(JSON.parse(JSON.stringify(request)) as SemanticSchemaManageRequest);
  return SemanticSchemaManageResultSchema.parse(response);
}
