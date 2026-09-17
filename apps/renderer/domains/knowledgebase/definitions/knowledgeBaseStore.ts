/**
 * Knowledge Base 仍由 legacy JavaScript Pinia store 实现。
 * 此合同只描述 TypeScript 编排层已经实际消费的公开 action，避免把内部响应式状态外泄。
 */
export interface KnowledgeBaseStoreContract {
  ensureDataLoaded(): Promise<void>;
  addFilesToQueue(knowledgeBaseId: string, files: File[]): void;
  startParsing(): Promise<void>;
}
