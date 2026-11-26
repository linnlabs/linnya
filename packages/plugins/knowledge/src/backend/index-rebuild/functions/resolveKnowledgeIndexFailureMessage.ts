import { EmbeddingFailure } from '@plugin/backend/inferenceFailures';
import { readKnowledgeEmbeddingFailureReason } from '../../infrastructure/inference/embeddingFailureReason';

/** 恢复界面使用正式失败码解释下一步；哪些码算凭据问题与检索共用同一份分类，上游文本不参与判断。 */
export function resolveKnowledgeIndexFailureMessage(error: unknown): string {
  if (error instanceof EmbeddingFailure && readKnowledgeEmbeddingFailureReason(error) === 'credential')
    return '嵌入模型认证失败，请检查模型密钥和服务配置后重试';
  return error instanceof Error ? error.message : String(error);
}
