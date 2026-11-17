import type { EmbeddingIndexChangeImpact } from '@linnya/plugin-host-contract/renderer/modelConfiguration';
export type EmbeddingModelChangeImpact = EmbeddingIndexChangeImpact;

/** 本产品设置的已有影响提示；公共插件合同由 app 装配映射，避免反向携带知识库语义。 */
export interface EmbeddingModelChangeImpactPort {
  findImpactedKnowledgeBases(nextModelId: string): Promise<readonly EmbeddingModelChangeImpact[]>;
  findKnowledgeBasesUsingModel(modelId: string): Promise<readonly EmbeddingModelChangeImpact[]>;
}

let registeredPort: EmbeddingModelChangeImpactPort | null = null;

export function registerEmbeddingModelChangeImpactPort(port: EmbeddingModelChangeImpactPort): () => void {
  registeredPort = port;
  return () => {
    // 旧插件实例的清理不能撤销升级后新实例的注册。
    if (registeredPort === port) registeredPort = null;
  };
}

export function getEmbeddingModelChangeImpactPort(): EmbeddingModelChangeImpactPort {
  if (!registeredPort) throw new Error('EmbeddingModelChangeImpactPort 尚未注册');
  return registeredPort;
}

/** 插件停用时设置仍可编辑，只能提示可能影响，不能猜测索引来源。 */
export function peekEmbeddingModelChangeImpactPort(): EmbeddingModelChangeImpactPort | null {
  return registeredPort;
}
