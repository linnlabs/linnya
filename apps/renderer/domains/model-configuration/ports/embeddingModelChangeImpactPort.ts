export interface EmbeddingModelChangeImpact {
  readonly id: string;
  readonly name: string;
  readonly documentCount: number;
}

export interface EmbeddingModelChangeImpactPort {
  findImpactedKnowledgeBases(nextModelId: string): Promise<readonly EmbeddingModelChangeImpact[]>;
  findKnowledgeBasesUsingModel(modelId: string): Promise<readonly EmbeddingModelChangeImpact[]>;
}

let registeredPort: EmbeddingModelChangeImpactPort | null = null;

export function registerEmbeddingModelChangeImpactPort(port: EmbeddingModelChangeImpactPort): void {
  registeredPort = port;
}

export function getEmbeddingModelChangeImpactPort(): EmbeddingModelChangeImpactPort {
  if (!registeredPort) throw new Error('EmbeddingModelChangeImpactPort 尚未注册');
  return registeredPort;
}

/** 插件停用时设置仍可编辑，只能提示可能影响，不能猜测索引来源。 */
export function peekEmbeddingModelChangeImpactPort(): EmbeddingModelChangeImpactPort | null {
  return registeredPort;
}
