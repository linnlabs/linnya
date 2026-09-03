import path from 'node:path';

export interface DialogDirectorySession {
  currentDirectory(): string;
  resolveFileDefaultPath(fileName: string): string;
  rememberDirectory(directoryPath: string): void;
  rememberFile(filePath: string): void;
}

function requireAbsolutePath(value: string, fieldName: string): string {
  if (!path.isAbsolute(value)) {
    throw new Error(`${fieldName} must be an absolute path`);
  }
  return path.normalize(value);
}

/**
 * 一个 feature 持有一个会话实例。它只记录该 feature 最近成功选择的目录，
 * 不把媒体、导出等不同产品语义合并成全局“最近路径”。
 */
export function createDialogDirectorySession(initialDirectory: string): DialogDirectorySession {
  let directory = requireAbsolutePath(initialDirectory, 'initialDirectory');

  return Object.freeze({
    currentDirectory(): string {
      return directory;
    },

    resolveFileDefaultPath(fileName: string): string {
      return path.isAbsolute(fileName) ? path.normalize(fileName) : path.join(directory, fileName);
    },

    rememberDirectory(directoryPath: string): void {
      directory = requireAbsolutePath(directoryPath, 'directoryPath');
    },

    rememberFile(filePath: string): void {
      directory = path.dirname(requireAbsolutePath(filePath, 'filePath'));
    },
  });
}
