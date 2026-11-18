import path from 'node:path';
import type { ModelPurposeSnapshot } from '@app/schemas';
import type { KnowledgeBase } from '../../../shared';

function required(id: string | null | undefined, label: string): string {
  if (!id) throw new Error(`未配置${label}。请在模型设置中选择后重新发起操作。`);
  return id;
}

/** 已有索引的模型不能被当前默认用途悄悄替换；其它用途沿父运行接纳时的选择。 */
export function resolveKnowledgeCliModels(
  kb: KnowledgeBase,
  snapshot: ModelPurposeSnapshot | undefined,
  filename?: string
) {
  const embeddingModelId = required(kb.embeddingModelId ?? snapshot?.embeddingModelId, '嵌入模型');
  const image =
    filename !== undefined &&
    ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(
      path.extname(filename).toLowerCase()
    );
  const imageVisionModelId = image
    ? required(snapshot?.imageVisionModelId, '图片识别模型')
    : (snapshot?.imageVisionModelId ?? undefined);
  const graphExtractionModelId =
    filename !== undefined && kb.enableGraphIndexing
      ? required(snapshot?.graphExtractionModelId, '知识图谱抽取模型')
      : undefined;
  return {
    embeddingModelId,
    imageVisionModelId,
    graphExtractionModelId,
    pdfOcrModelId: snapshot?.pdfOcrModelId ?? undefined,
  };
}
