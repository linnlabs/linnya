import type { PluginWorkerDatabase } from './worker/databaseRuntime';

/**
 * 官方插件接管 Host 既有表时借用的工作区连接与产品数据目录。
 *
 * - 只向产品准入的同源官方 artifact 开放（目前只有知识库）；插件自报 ID 或 builtin 不构成授权。
 * - 连接是整个工作区库的 prepare/transaction：插件只能读写 manifest `ownedTables` 声明的表。
 *   运行时不按表拦截，这条由准入来源、插件自己的数据库测试和审查保证；新插件需要独立存储时不要用它。
 * - 不授予 exec、迁移或连接生命周期；数据目录由产品装配映射，不能以参数选择 Host 路径。
 */
export interface AdoptedHostData {
  readonly database: Pick<PluginWorkerDatabase, 'prepare' | 'transaction'>;
  readonly dataDirectory: string;
}

export declare function getAdoptedHostData(pluginId: string): AdoptedHostData;
