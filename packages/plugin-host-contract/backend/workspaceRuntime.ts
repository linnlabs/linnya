export interface PluginWorkspaceRuntimeNode {
  readonly id: string;
  readonly project_id: string | null;
  readonly parent_id?: string | null;
  readonly type: string;
  readonly name: string;
  readonly icon?: string | null;
  readonly created_at?: number;
  readonly updated_at?: number;
  readonly deleted_at?: number | null;
  readonly last_opened_at?: number | null;
  readonly access_count?: number;
  readonly tags?: string | null;
}

export interface PluginWorkspaceServicePort {
  createNode(params: {
    readonly type: string;
    readonly name: string;
    readonly projectId?: string | null;
    readonly parentId?: string | null;
    readonly icon?: string | null;
  }): PluginWorkspaceRuntimeNode;
  getNode(id: string): PluginWorkspaceRuntimeNode | null;
  renameNode(id: string, newName: string): void;
  deleteNode(id: string): void;
  createAvailableSiblingName?(params: {
    readonly projectId: string | null;
    readonly parentId: string | null;
    readonly desiredName: string;
    readonly excludeNodeId?: string;
  }): string;
  createAvailableSiblingCopyName?(params: {
    readonly projectId: string | null;
    readonly parentId: string | null;
    readonly sourceName: string;
  }): string;
  moveNode?(id: string, newParentId: string | null): void;
  notifyDocumentOpened?(id: string): void;
}

/** 由宿主解析 conversation-scoped 相对文件，插件不接触工作目录生命周期实现。 */
export interface PluginConversationFilePathResolverPort {
  resolveRelativePath(input: {
    readonly conversationId: string;
    readonly relativePath: string;
  }): Promise<string>;
}

/** 从宿主工具上下文取得 conversation 文件解析端口；无会话工作区能力时不提供。 */
export declare function createConversationFilePathResolver(
  contextValue: unknown,
): PluginConversationFilePathResolverPort | undefined;

export type PluginLoggerDetails = unknown;

export interface PluginLoggerPort {
  debug(message: string, details?: PluginLoggerDetails): void;
  info(message: string, details?: PluginLoggerDetails): void;
  warn(message: string, details?: PluginLoggerDetails): void;
  error(message: string, details?: PluginLoggerDetails): void;
}

export interface PluginLoggerConstructor {
  new (moduleName: string): PluginLoggerPort;
}

export interface PluginSchemaProvider {
  readonly name: string;
  getSchema(): string[];
}

export type ISchemaProvider = PluginSchemaProvider;

export interface PluginVersionRetentionPolicy {
  readonly keepFirst: boolean;
  readonly keepRecent: number;
  readonly sparseBucketDays: number;
  readonly keepSparseBuckets: number;
}

export type VersionRetentionPolicy = PluginVersionRetentionPolicy;

export interface PluginSqliteStatementLike {
  get?: (...params: never[]) => unknown;
  all?: (...params: never[]) => unknown[];
  run?: (...params: never[]) => unknown;
}

export interface PluginSqliteTransactionLike<T = unknown> {
  immediate(): T;
}

export interface PluginSqliteDatabaseLike {
  prepare(sql: string): PluginSqliteStatementLike;
  exec?(sql: string): unknown;
  transaction?<T>(fn: () => T): PluginSqliteTransactionLike<T>;
}

export interface PluginToolVfsNodeResolveInput {
  readonly path?: string;
  readonly inode?: string;
}

export interface PluginToolResolvedVfsNode {
  readonly id: string;
  readonly inode: string;
  readonly path: string;
  readonly type: string;
  readonly name: string;
}

export type PluginToolVfsNodeResolveResult =
  | { readonly ok: true; readonly node: PluginToolResolvedVfsNode }
  | { readonly ok: false; readonly message: string; readonly hint?: string };

export declare class WorkspaceService implements PluginWorkspaceServicePort {
  constructor(db: PluginSqliteDatabaseLike);
  createNode(params: {
    readonly type: string;
    readonly name: string;
    readonly projectId?: string | null;
    readonly parentId?: string | null;
    readonly icon?: string | null;
  }): PluginWorkspaceRuntimeNode;
  getNode(id: string): PluginWorkspaceRuntimeNode | null;
  renameNode(id: string, newName: string): void;
  deleteNode(id: string): void;
  createAvailableSiblingName(params: {
    readonly projectId: string | null;
    readonly parentId: string | null;
    readonly desiredName: string;
    readonly excludeNodeId?: string;
  }): string;
  createAvailableSiblingCopyName(params: {
    readonly projectId: string | null;
    readonly parentId: string | null;
    readonly sourceName: string;
  }): string;
  moveNode(id: string, newParentId: string | null): void;
  notifyDocumentOpened(id: string): void;
}

export declare function createWorkspaceService(db: PluginSqliteDatabaseLike): PluginWorkspaceServicePort;

/** 兼容既有 workspaceRuntime 消费方；新只读进程应直接使用窄门面。 */
export { getWorkspaceDatabasePath } from './workspaceDatabasePath';

export type PluginWorkspaceDocumentMutationKind = 'version' | 'pending' | 'incremental';

export interface PluginWorkspaceDocumentUpdatedPayload {
  readonly projectId: string | null;
  readonly documentId: string;
  readonly nodeType: string;
  readonly mutationKind: PluginWorkspaceDocumentMutationKind;
  readonly versionNumber?: number;
}

export declare function publishWorkspaceDocumentUpdated(
  payload: PluginWorkspaceDocumentUpdatedPayload,
): void;

export declare class Logger implements PluginLoggerPort {
  constructor(moduleName: string);
  debug(message: string, details?: PluginLoggerDetails): void;
  info(message: string, details?: PluginLoggerDetails): void;
  warn(message: string, details?: PluginLoggerDetails): void;
  error(message: string, details?: PluginLoggerDetails): void;
}

export declare function isUsingNewDatabase(): boolean;

export declare function pruneVersionTable(params: {
  readonly db: PluginSqliteDatabaseLike;
  readonly tableName: string;
  readonly nodeIdColumn: string;
  readonly versionColumn: string;
  readonly createdAtColumn: string;
  readonly nodeId: string;
  readonly policy: PluginVersionRetentionPolicy;
}): { readonly kept: number; readonly removed: number };

export declare function saveWorkspaceNodeTextSnapshot(params: {
  readonly db: PluginSqliteDatabaseLike;
  readonly nodeId: string;
  readonly contentType: string;
  readonly text: string;
  readonly sourcePluginId?: string | null;
  readonly sourceNodeType?: string | null;
  readonly updatedAt?: number;
}): void;

export declare function resolveWorkspaceVfsNodeForPluginTool(
  contextValue: unknown,
  input: PluginToolVfsNodeResolveInput,
): Promise<PluginToolVfsNodeResolveResult>;
