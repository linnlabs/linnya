import type { WorkspaceCreatedFileIdentity } from './workspaceDocumentFileCreate';

/** 插件创建跨异步边界失败时保留已提交目录，并保留取消/恢复信号的原身份。 */
export class WorkspaceDocumentFileCreateFailure extends Error {
  readonly cause: unknown;
  readonly code?: string;

  constructor(
    error: unknown,
    readonly createdFolders: readonly WorkspaceCreatedFileIdentity[]
  ) {
    const reason = error instanceof Error ? error.message : String(error);
    super(
      `${reason}\n文档创建未确认；以下目录已经创建并保留，可用 list_files 检查后重试。\ncreated_folders: ${JSON.stringify(createdFolders.map(folder => ({ locator: `workspace:${folder.path}`, inode: folder.inode })))}`
    );
    this.cause = error;
    this.name = error instanceof Error ? error.name : 'Error';
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      this.code = error.code;
    }
  }
}
