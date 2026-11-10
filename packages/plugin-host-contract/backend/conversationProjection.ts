import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

/** 当前正式会话归属；不存在或 Linnya 助手会话返回 null。只读，不接触事件正文。 */
export declare function readConversationProjectId(database: Pick<PluginSqliteDatabaseLike, 'prepare'>, conversationId: string): string | null;
