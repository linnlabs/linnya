import type { PluginSqliteStatementPort, PluginSqliteTransactionPort } from '../toolRuntime';

export interface PluginWorkerStatement extends PluginSqliteStatementPort {
  run(...params: readonly unknown[]): {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  };
}

export interface PluginWorkerTransaction<T> extends PluginSqliteTransactionPort<T> {
  (): T;
}

/** 行保持 unknown，由业务 owner 解码；不把 native DB 类型变为插件合同。 */
export interface PluginWorkerDatabase {
  prepare(sql: string): PluginWorkerStatement;
  transaction<T>(fn: () => T): PluginWorkerTransaction<T>;
  close(): void;
}

/** 只连接 Host 为本线程冻结、且已完成迁移的 Workspace 数据库。 */
export declare function openPluginWorkerDatabase(): PluginWorkerDatabase;
