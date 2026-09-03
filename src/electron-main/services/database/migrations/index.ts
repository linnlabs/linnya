/**
 * @file migrations/index.ts
 * @description Host Schema 基线与增量迁移注册表。
 *
 * v61 是当前不兼容开发基线的身份，不表示新库需要重放 v1-v60。
 * 全新数据库始终由当前 schema providers 一次建立；这里只注册 v61 之后仍被
 * 当前版本明确支持的增量迁移。
 */

import type { HostSchemaMigration } from './types';
import { migrateV61ToV62SubrunSummaryTrace } from './v61-to-v62-subrun-summary-trace';
import { migrateV62ToV63CitationFactIndex } from './v62-to-v63-citation-fact-index';

export type { HostSchemaMigration, MigrationFunction } from './types';

/** 当前代码仍接受的最早 Host Schema。 */
export const HOST_SCHEMA_BASELINE_VERSION = 61;

/** 当前 Host Schema 版本。修改既有表或数据语义时必须递增。 */
export const SCHEMA_VERSION = 63;

/**
 * v61 基线之后的受支持迁移。
 *
 * 新迁移必须显式声明 fromVersion，不能再依赖“数组下标就是旧版本”这种把
 * 已删除历史永久绑在运行时代码上的表示方式。
 */
export const migrations: readonly HostSchemaMigration[] = [
  {
    fromVersion: 61,
    migrate: migrateV61ToV62SubrunSummaryTrace,
  },
  {
    fromVersion: 62,
    migrate: migrateV62ToV63CitationFactIndex,
  },
];
