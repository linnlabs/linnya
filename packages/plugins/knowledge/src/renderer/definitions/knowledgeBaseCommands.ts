/** 调用方只需要上传与加载命令时使用的窄公开合同。 */
export interface KnowledgeBaseCommands {
  ensureDataLoaded(): Promise<void>;
  addFilesToQueue(knowledgeBaseId: string, files: File[]): void;
  startParsing(): Promise<void>;
}
