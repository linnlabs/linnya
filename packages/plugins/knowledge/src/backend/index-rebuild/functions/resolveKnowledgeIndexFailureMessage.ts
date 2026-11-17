import { EmbeddingFailure } from '@plugin/backend/inferenceFailures';

/** 恢复界面使用正式失败码解释下一步；上游文本不参与错误类别判断。 */
export function resolveKnowledgeIndexFailureMessage(error: unknown): string {
  if (error instanceof EmbeddingFailure && (
    error.code === 'provider_http_401' || error.code === 'provider_http_403' || error.code === 'credential_missing'
  )) return '嵌入模型认证失败，请检查模型密钥和服务配置后重试';
  return error instanceof Error ? error.message : String(error);
}
