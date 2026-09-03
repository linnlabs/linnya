/**
 * @file src/shared/database/schema-provider.ts
 *
 * @description 数据库 Schema Provider 标准接口。
 *
 * 设计说明：
 * - 这是一个**纯类型/接口文件**，不依赖 Electron。
 * - 任何需要向 workspace.sqlite 注册表结构的模块，都应实现该接口。
 * - Electron 主进程的 `DatabaseService` 负责收集并执行这些 DDL。
 */

export interface ISchemaProvider {
  /**
   * 模块的唯一名称，用于日志和调试
   */
  readonly name: string;

  /**
   * 返回该模块所有表的 CREATE TABLE / CREATE INDEX 等 DDL 语句数组
   */
  getSchema(): string[];

  /**
   * (可选) 返回该模块的数据库迁移脚本
   *
   * 注意：当前项目的迁移主入口是 `electron-main/services/database/migrations.ts`，
   * 这里先保留扩展点，方便未来按 Feature 拆迁移。
   */
  getMigrations?(fromVersion: number, toVersion: number): string[];
}


