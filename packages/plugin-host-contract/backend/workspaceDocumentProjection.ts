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
