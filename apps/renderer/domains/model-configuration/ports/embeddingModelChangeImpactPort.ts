export interface EmbeddingModelChangeImpact {
  readonly id: string;
  readonly name: string;
  readonly documentCount: number;
}

export interface EmbeddingModelChangeImpactPort {
  findImpactedKnowledgeBases(nextModelId: string): Promise<readonly EmbeddingModelChangeImpact[]>;
}

let registeredPort: EmbeddingModelChangeImpactPort | null = null;

export function registerEmbeddingModelChangeImpactPort(
  port: EmbeddingModelChangeImpactPort,
): void {
  registeredPort = port;
}

export function getEmbeddingModelChangeImpactPort(): EmbeddingModelChangeImpactPort {
  if (!registeredPort) throw new Error('EmbeddingModelChangeImpactPort 尚未注册');
  return registeredPort;
}
