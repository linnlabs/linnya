export interface CommandOutputArtifactWritableFile {
  write(
    bytes: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/**
 * 该窄接口用于对真实文件边界做故障注入，不是第二套存储抽象。
 * 生产实现仍只使用 Node 文件系统；测试可以稳定复现磁盘中途失败，而不依赖破坏宿主磁盘。
 */
export interface CommandOutputArtifactFileOperations {
  ensureDirectory(directoryPath: string): Promise<void>;
  createDirectory(directoryPath: string): Promise<void>;
  openExclusive(filePath: string): Promise<CommandOutputArtifactWritableFile>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  removeDirectory(directoryPath: string): Promise<void>;
}
