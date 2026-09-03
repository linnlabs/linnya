import type { AgentInvocationRequest } from 'linnkit/ports';
import type { LinnyaToolSchemaContext } from 'src/tools/types';

/**
 * 在 Host port 边界验证 Linnya 的产品请求扩展，并只向 concrete tools 暴露
 * 动态 Schema 真正需要的字段。完整 query/history 不得进入工具 Schema 上下文。
 */
export function deriveLinnyaToolSchemaContext(
  invocation: AgentInvocationRequest,
): LinnyaToolSchemaContext {
  if (!('imageGenerationModelId' in invocation)) {
    return {};
  }

  const candidate = invocation.imageGenerationModelId;
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return {};
  }

  return { imageGenerationModelId: candidate.trim() };
}
