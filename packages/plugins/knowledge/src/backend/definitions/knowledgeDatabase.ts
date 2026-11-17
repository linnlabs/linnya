import type { PluginStorage } from '@plugin/backend/storageRuntime';

/** 插件只借用自有表读写连接，连接、迁移及关闭归 Host。 */
export type KnowledgeDatabase = PluginStorage['database'];
