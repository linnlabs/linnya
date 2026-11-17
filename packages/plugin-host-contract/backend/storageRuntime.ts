import type { PluginWorkerDatabase } from './worker/databaseRuntime';

/** 借用已迁移的连接；SQL 所有权属于插件声明的表，不授予迁移或连接生命周期。 */
export interface PluginStorage {
  readonly database: Pick<PluginWorkerDatabase, 'prepare' | 'transaction'>;
  readonly dataDirectory: string;
}

/** 数据目录由产品装配映射，不能以参数选择 Host 路径。 */
export declare function getPluginStorage(pluginId: string): PluginStorage;
