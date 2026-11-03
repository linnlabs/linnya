import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

/** 当前活动节点的归属事实；不含插件正文或业务版本。 */
export interface WorkspaceDocumentMetadata {
  readonly projectId: string | null;
}
export declare function readWorkspaceDocumentMetadata(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>,
  nodeId: string
): WorkspaceDocumentMetadata | null;
export declare function listWorkspaceDocumentIds(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>,
  input: { readonly projectId: string; readonly nodeType: string }
): readonly string[];
/** 在调用方已有的 SQLite 事务内更新时间；不提前发布 mutation 事件。 */
export declare function touchWorkspaceDocument(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>,
  nodeId: string,
  updatedAt: number
): void;

export interface WorkspaceDocumentIdentity {
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly nodeType: string;
  readonly deletedAt: number | null;
}
export declare function readWorkspaceDocumentIdentity(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>,
  nodeId: string,
): WorkspaceDocumentIdentity | null;

/** 活动文档的当前 VFS 地址；路径用于展示，稳定身份仍是 id。 */
export declare function readWorkspaceDocumentLocation(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>,
  nodeId: string,
): { readonly id: string; readonly projectId: string | null; readonly path: string; readonly nodeType: string } | null;
