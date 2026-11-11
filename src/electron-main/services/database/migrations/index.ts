import { migrateV73ToV74DocumentActions } from './v73-to-v74-document-actions';
import { migrateV74ToV75RetireWorkspaceNodeTags } from './v74-to-v75-retire-workspace-node-tags';
import { migrateV75ToV76ActionLedgerAgent } from './v75-to-v76-action-ledger-agent';
import { migrateV76ToV77ReadableConversationIndex } from './v76-to-v77-readable-conversation-index';
import { migrateV77ToV78SemanticTagCreator } from './v77-to-v78-semantic-tag-creator';
/**
 * @file migrations/index.ts
 * @description Host Schema 基线与增量迁移注册表。
 *
 * v61 是当前不兼容开发基线的身份，不表示新库需要重放 v1-v60。
 * 全新数据库始终由当前 schema providers 一次建立；这里只注册 v61 之后仍被
 * 当前版本明确支持的增量迁移。
 */

import { migrateV64ToV65ConversationExecutionNotices } from './v64-to-v65-conversation-execution-notices';
import { migrateV65ToV66ConversationClientNotice } from './v65-to-v66-conversation-client-notice';
import { migrateV66ToV67ConversationCitationMetadata } from './v66-to-v67-conversation-citation-metadata';
import { migrateV67ToV68MarkdownImageCaption } from './v67-to-v68-markdown-image-caption';
import { migrateV68ToV69WorkspaceSearchFts } from './v68-to-v69-workspace-search-fts';
import { migrateV69ToV70RunCostLedgerTotals } from './v69-to-v70-run-cost-ledger-totals';
import { migrateV70ToV71AssetRelativeLocalPaths } from './v70-to-v71-asset-relative-local-paths';
import { migrateV71ToV72ToolResultSources } from './v71-to-v72-tool-result-sources';
import { migrateV72ToV73CompactConversationHistory } from './v72-to-v73-compact-conversation-history';
import type { HostSchemaMigration } from './types';
import { migrateV61ToV62SubrunSummaryTrace } from './v61-to-v62-subrun-summary-trace';
import { migrateV62ToV63CitationFactIndex } from './v62-to-v63-citation-fact-index';
import { migrateV63ToV64MarkdownPendingRevision } from './v63-to-v64-markdown-pending-revision';

export type { HostSchemaMigration, MigrationFunction } from './types';

/** 当前代码仍接受的最早 Host Schema。 */
export const HOST_SCHEMA_BASELINE_VERSION = 61;

/** 当前 Host Schema 版本。修改既有表或数据语义时必须递增。 */
export const SCHEMA_VERSION = 78;

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
  {
    fromVersion: 63,
    migrate: migrateV63ToV64MarkdownPendingRevision,
  },
  { fromVersion: 64, migrate: migrateV64ToV65ConversationExecutionNotices },
  { fromVersion: 65, migrate: migrateV65ToV66ConversationClientNotice },
  { fromVersion: 66, migrate: migrateV66ToV67ConversationCitationMetadata },
  { fromVersion: 67, migrate: migrateV67ToV68MarkdownImageCaption },
  { fromVersion: 68, migrate: migrateV68ToV69WorkspaceSearchFts },
  { fromVersion: 69, migrate: migrateV69ToV70RunCostLedgerTotals },
  { fromVersion: 70, migrate: migrateV70ToV71AssetRelativeLocalPaths },
  { fromVersion: 71, migrate: migrateV71ToV72ToolResultSources },
  { fromVersion: 72, migrate: migrateV72ToV73CompactConversationHistory },
  { fromVersion: 73, migrate: migrateV73ToV74DocumentActions },
  { fromVersion: 74, migrate: migrateV74ToV75RetireWorkspaceNodeTags },
  { fromVersion: 75, migrate: migrateV75ToV76ActionLedgerAgent },
  { fromVersion: 76, migrate: migrateV76ToV77ReadableConversationIndex },
  { fromVersion: 77, migrate: migrateV77ToV78SemanticTagCreator },
];
