export interface ReadHistoricalKnowledgeSearchSnapshotRequest {
  readonly conversationId: string;
  readonly bundleId: string;
}

/** Conversation 只依赖历史证据读取能力，不直接依赖 KnowledgeBase domain 实现。 */
export interface KnowledgeSearchHistoryPort {
  readCitationSnapshot(request: ReadHistoricalKnowledgeSearchSnapshotRequest): Promise<unknown>;
}

let registeredPort: KnowledgeSearchHistoryPort | null = null;

export function registerKnowledgeSearchHistoryPort(port: KnowledgeSearchHistoryPort): () => void {
  registeredPort = port;
  return () => {
    if (registeredPort === port) registeredPort = null;
  };
}

export function getKnowledgeSearchHistoryPort(): KnowledgeSearchHistoryPort {
  if (!registeredPort) {
    throw new Error('Knowledge Search history port has not been installed');
  }
  return registeredPort;
}
