/**
 * @file database.ts
 * @description DatabaseService - 统一的数据库连接和 Schema 管理服务。
 *
 * 职责：
 * 1. 管理 workspace.sqlite 的单一数据库连接
 * 2. 在应用启动时，自动收集并执行所有注册的 Schema Provider 的 DDL 语句
 * 3. 提供数据库连接给其他服务使用
 * 4. 处理数据库迁移和版本管理
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { ISchemaProvider } from './database/schema-provider';
import { getWorkspaceSchemaProviders } from '../../features/workspace/infrastructure/sqlite/schema-providers';
import { getConversationSchemaProviders } from '../../app-hosts/linnya/adapters/persistence/event-store/schema-providers';
import { getCitationRefClaimSchemaProviders } from '../../app-hosts/linnya/adapters/persistence/citation-ref-claims/schema-provider';
import { getConversationFilesSchemaProviders } from '../../app-hosts/linnya/adapters/persistence/conversation-files/schema-providers';
import { getCommandApprovalsSchemaProviders } from '../../app-hosts/linnya/adapters/persistence/command-approvals/schema-providers';
import { getCommandCardSettlementsSchemaProviders } from '../../app-hosts/linnya/adapters/persistence/command-card-settlements/schema-providers';
import { getCheckpointerSchemaProviders } from '../../app-hosts/linnya/adapters/persistence/checkpointer/schema-providers';
import { getRunDescriptorSchemaProviders } from '../../app-hosts/linnya/adapters/persistence/run-descriptors/schema-providers';
import { getRunCostSchemaProviders } from '../../app-hosts/linnya/adapters/token-accounting/schema-providers';
import { getTelemetrySchemaProviders } from '../../app-hosts/linnya/adapters/telemetry/schema-providers';
import { getKnowledgeBaseSchemaProviders } from '../../features/knowledge-base/infrastructure/sqlite/schema-providers';
import { getAssetSchemaProviders } from '../../domains/assets/features/asset-ledger/infrastructure/sqlite/schemaProviders';
import { getMarkdownSchemaProviders } from '../../domains/markdown/features/document-storage/infrastructure/sqlite/schemaProviders';
import { getPluginStateSchemaProviders } from '../../features/plugins/infrastructure/sqlite/schema-providers';
import { getWorkspaceDataPath } from '../../shared/utils/pathManager';
import {
  assertSupportedHostSchemaVersion,
  runMigrations,
  SCHEMA_VERSION,
} from './database/migrations';

export const DATABASE_BUSY_TIMEOUT_MS = 5000;

export type DatabaseLifecycleBootstrap = (db: Database.Database) => void;

export interface DatabaseInitializeOptions {
  /**
   * 中文说明：插件 lifecycle 属于 Linnya app host 的启动编排，不属于基础 DB 连接能力。
   * 由 Electron 主进程显式注入，避免 worker 线程仅为了打开 SQLite 连接就静态加载插件运行时/Electron。
   */
  readonly lifecycleBootstrap?: DatabaseLifecycleBootstrap;
}

export class DatabaseService {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly providers: ISchemaProvider[];

  constructor(dbPath?: string) {
    // 确定数据库文件路径 - *** 修改：支持自定义路径用于测试 ***
    if (dbPath) {
      this.dbPath = dbPath;
    } else {
      const workspaceDataPath = getWorkspaceDataPath();
      this.dbPath = path.join(workspaceDataPath, 'workspace.sqlite');
    }

    // 注册所有 Schema Providers
    this.providers = [
      ...getWorkspaceSchemaProviders(),
      ...getAssetSchemaProviders(),
      ...getMarkdownSchemaProviders(),
      ...getPluginStateSchemaProviders(),
      ...getConversationSchemaProviders(),
      ...getCitationRefClaimSchemaProviders(),
      ...getConversationFilesSchemaProviders(),
      ...getCommandApprovalsSchemaProviders(),
      ...getCommandCardSettlementsSchemaProviders(),
      ...getCheckpointerSchemaProviders(),
      ...getRunDescriptorSchemaProviders(),
      ...getRunCostSchemaProviders(),
      ...getTelemetrySchemaProviders(),
      ...getKnowledgeBaseSchemaProviders(),
    ];

    console.log(`[DB-LIFECYCLE] CONSTRUCTOR | Database path set to: ${this.dbPath}`);
  }

  /**
   * 初始化数据库连接并创建所有表
   */
  initialize(options: DatabaseInitializeOptions = {}): void {
    if (this.db) {
      console.warn('[DatabaseService] Database already initialized');
      return;
    }

    try {
      console.log('[DatabaseService] Initializing database...');

      const isFreshDatabase = this.isFreshDatabaseTarget();
      const db = this.openConnection();

      const currentVersion = db.pragma('user_version', { simple: true }) as number;
      console.log(
        `[DatabaseService] Current DB version: ${currentVersion}, App schema version: ${SCHEMA_VERSION}`
      );

      if (!isFreshDatabase) {
        // 兼容性检查必须早于持久化 pragma、schema provider、插件 lifecycle 或索引写入。
        // 不受支持的数据库只报告处理方式，绝不在失败前混入当前结构。
        assertSupportedHostSchemaVersion(currentVersion);
      }

      this.configureConnection(db);

      // ============================================================
      // 核心契约：当前基线内，createTables() 每次 init 都跑。
      //
      // 原因：
      // 1) 所有 schema-provider DDL 都是 CREATE TABLE/INDEX IF NOT EXISTS
      //    形式，重复执行 100% 幂等无副作用。
      // 2) 新增 schema-provider 表不需要再配一条重复 migration；当前基线内的
      //    已有数据库也会执行幂等 DDL。
      // 3) 受支持基线内，schema-provider 的表 DDL 先于 runMigrations()，索引 DDL 后于
      //    runMigrations()。原因是 CREATE TABLE IF NOT EXISTS 不会给旧表补列，
      //    但 CREATE INDEX 会立即解析列名；新增列必须先由 migration 补齐。
      //
      // 注意：依赖 schema-provider DDL 始终保持幂等。新增/修改 DDL 时
      // 必须保持 IF NOT EXISTS / 不写 ALTER / 不写数据写入。
      // 详见 services/database/migrations/README.md。
      // ============================================================
      if (isFreshDatabase) {
        // 新库只建立“当前事实”，不能重放包含已暂停/退役能力的历史演进。
        // 表结构与版本戳放在同一事务中；若进程中断，下次不会把半成品误认成当前库。
        const bootstrapCurrentSchema = db.transaction(() => {
          this.createTables();
          db.pragma(`user_version = ${SCHEMA_VERSION}`);
        });
        bootstrapCurrentSchema();
        console.log(
          `[DatabaseService] Fresh database bootstrapped directly at schema v${SCHEMA_VERSION}.`
        );
      } else {
        this.createTables();
      }

      if (!isFreshDatabase) {
        if (currentVersion < SCHEMA_VERSION) {
          console.log(
            `[DatabaseService] Database schema requires migration from v${currentVersion} to v${SCHEMA_VERSION}.`
          );
          runMigrations(db, currentVersion, SCHEMA_VERSION);
        } else {
          console.log('[DatabaseService] Database schema is up-to-date.');
        }
      }

      // 插件 lifecycle 必须由 app-level orchestration 显式注入：
      // - installed_plugins / plugin_migrations 是宿主插件平台表，由当前 provider 建立；
      // - 插件 schema provider 不能放进 createTables()，否则会早于插件安装态执行；
      // - worker 只需要轻量 DB 连接，不能因为 import DatabaseService 静态加载 Electron/plugin runtime。
      options.lifecycleBootstrap?.(db);

      this.createIndexes();

      console.log('[DatabaseService] Database initialized successfully');
    } catch (error) {
      console.error('[DatabaseService] Failed to initialize database:', error);
      // 初始化失败后不能继续通过 getDb() 使用半初始化连接。事务负责回滚当前步骤，
      // 这里负责收口连接生命周期。
      this.close();
      throw error;
    }
  }

  /**
   * 只打开连接，不应用 pragma。Host Schema 兼容性必须先用原始连接只读判断，
   * 避免被拒绝的数据库仅因检查就被切换 journal mode。
   */
  private openConnection(): Database.Database {
    if (this.db) {
      return this.db;
    }
    const db = new Database(this.dbPath);
    this.db = db;
    return db;
  }

  /**
   * 在版本准入之后统一设置 main / worker 连接 pragma。
   *
   * busy_timeout 必须覆盖每条正式连接：多连接 WAL 下写者仍互斥，否则并发写会
   * 直接抛 SQLITE_BUSY（见 F1-03）。
   */
  private configureConnection(db: Database.Database): void {
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS}`);
    db.pragma('journal_mode = WAL');
  }

  /**
   * fresh 身份只来自打开连接前明确的文件事实。已有 SQLite 即使 user_version=0，
   * 也可能是旧版或中断数据，不能伪装成新库绕过历史升级与诊断。
   */
  private isFreshDatabaseTarget(): boolean {
    if (this.dbPath === ':memory:') {
      return true;
    }
    if (!fs.existsSync(this.dbPath)) {
      return true;
    }
    return fs.statSync(this.dbPath).size === 0;
  }

  /**
   * Worker 线程专用：只打开连接 + 设 pragma，不建表 / 不迁移 / 不引导插件 lifecycle。
   *
   * 背景（F1-02）：worker 线程模块状态隔离，`getDatabaseService()` 在每个 worker 里是独立单例。
   * 过去 worker 直接调 `initialize()`，会在每个 worker、每次 spawn 重跑整套 schema bootstrap，
   * 还把本应主进程一次性的 `bootstrapBuiltinPluginLifecycle()` 拖进 worker 并发执行，
   * 与主进程/其他 worker 争抢插件状态表（见 DB-06 并发风险）。
   *
   * 契约（重要，勿改）：worker 由主进程任务队列在 app 启动后 spawn，主进程此时已完成 `initialize()`，
   * `workspace.sqlite` 的 schema 一定已就绪。worker 需要的只是一条带相同 pragma 的连接。
   * 若 schema 未就绪（`user_version` 与应用 `SCHEMA_VERSION` 不一致），说明调用时序被破坏，
   * 这里立即抛错而非静默重新 bootstrap——后者会掩盖时序问题并触发插件 lifecycle 并发执行。
   */
  initializeConnectionOnly(): void {
    if (this.db) {
      return;
    }
    const db = this.openConnection();
    const currentVersion = db.pragma('user_version', { simple: true }) as number;
    if (currentVersion !== SCHEMA_VERSION) {
      this.close();
      throw new Error(
        `[DatabaseService] initializeConnectionOnly() 要求主进程先完成 initialize()：` +
          `db user_version=${currentVersion}，app SCHEMA_VERSION=${SCHEMA_VERSION}。` +
          `worker 连接不得自行 bootstrap schema 或插件 lifecycle。`
      );
    }
    this.configureConnection(db);
  }

  private isIndexDdl(ddl: string): boolean {
    return /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(ddl);
  }

  private applyProviderSchemas(options: {
    label: string;
    shouldApply: (ddl: string) => boolean;
  }): void {
    if (!this.db) {
      throw new Error('[DatabaseService] Database not initialized');
    }

    console.log(`[DatabaseService] Creating ${options.label}...`);

    // 在事务中执行所有 DDL 语句
    const transaction = this.db.transaction(() => {
      for (const provider of this.providers) {
        console.log(`[DatabaseService] Applying schema from provider: ${provider.name}`);
        const schemas = provider.getSchema();

        for (const ddl of schemas) {
          if (!options.shouldApply(ddl)) {
            continue;
          }
          try {
            this.db!.exec(ddl);
          } catch (error) {
            console.error(`[DatabaseService] Failed to execute DDL from ${provider.name}:`, error);
            console.error(`[DatabaseService] DDL statement:\n${ddl}`);
            throw error;
          }
        }

        console.log(`[DatabaseService] ✓ Schema from ${provider.name} applied successfully`);
      }
    });

    transaction();
    console.log(`[DatabaseService] All ${options.label} created successfully`);
  }

  /**
   * 遍历所有 Schema Providers 并执行非索引 DDL。
   *
   * 中文备注：
   * - 这里故意跳过 CREATE INDEX；
   * - 老库的旧表不会因为 CREATE TABLE IF NOT EXISTS 自动补列；
   * - 因此索引必须等 runMigrations() 补完新增列之后再创建。
   */
  private createTables(): void {
    this.applyProviderSchemas({
      label: 'tables',
      shouldApply: ddl => !this.isIndexDdl(ddl),
    });

    // this.applyPostSchemaMigrations(); // ⚠️ 废弃：迁移逻辑已移至 migrations.ts
  }

  /**
   * 遍历所有 Schema Providers 并执行索引 DDL。
   */
  private createIndexes(): void {
    this.applyProviderSchemas({
      label: 'indexes',
      shouldApply: ddl => this.isIndexDdl(ddl),
    });
  }

  /* ⚠️ 废弃：旧的硬编码迁移逻辑
  private applyPostSchemaMigrations(): void {
    if (!this.db) {
      return;
    }

    try {
      const columns = this.db.prepare('PRAGMA table_info(workspace_nodes)').all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((column) => column.name));

      if (!columnNames.has('last_opened_at')) {
        console.log('[DatabaseService] Applying migration: add workspace_nodes.last_opened_at');
        this.db.exec('ALTER TABLE workspace_nodes ADD COLUMN last_opened_at INTEGER');
      }

      if (!columnNames.has('access_count')) {
        console.log('[DatabaseService] Applying migration: add workspace_nodes.access_count');
        this.db.exec('ALTER TABLE workspace_nodes ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0');
      }

      if (!columnNames.has('tags')) {
        console.log('[DatabaseService] Applying migration: add workspace_nodes.tags');
        this.db.exec('ALTER TABLE workspace_nodes ADD COLUMN tags TEXT');
      }
    } catch (error) {
      console.error('[DatabaseService] Failed during post-schema migrations:', error);
      throw error;
    }
  }
  */

  /**
   * 获取数据库连接实例
   * @returns Database 实例
   */
  getDb(): Database.Database {
    if (!this.db) {
      console.error(
        '[DB-LIFECYCLE] GETDB | ❌❌❌ FAILED. DB not initialized when getDb() was called.'
      );
      throw new Error('[DatabaseService] Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      console.log('[DatabaseService] Closing database connection...');
      this.db.close();
      this.db = null;
      console.log('[DatabaseService] Database connection closed');
    }
  }

  /**
   * 执行数据库备份
   * @param backupPath 备份文件路径
   */
  backup(backupPath: string): void {
    if (!this.db) {
      throw new Error('[DatabaseService] Database not initialized');
    }

    console.log(`[DatabaseService] Creating backup at: ${backupPath}`);
    this.db.backup(backupPath);
    console.log('[DatabaseService] Backup completed successfully');
  }
}

// 导出单例实例
let databaseServiceInstance: DatabaseService | null = null;

export function getDatabaseService(): DatabaseService {
  if (!databaseServiceInstance) {
    databaseServiceInstance = new DatabaseService();
  }
  return databaseServiceInstance;
}
