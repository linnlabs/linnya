/**
 * @file schema-provider-contract.test.ts
 * @description 核心 schema-provider DDL 契约回归测试。
 *
 * DB-02 契约：DatabaseService.initialize() 每次启动都会执行核心 schema-provider。
 * 因此这些 DDL 必须始终是幂等的 create-only 语句，不能把 migration 或数据写入混进来。
 */

import { describe, expect, it } from 'vitest';

import type { ISchemaProvider } from '../schema-provider';
import { getConversationSchemaProviders } from '../../../../app-hosts/linnya/adapters/persistence/event-store/schema-providers';
import { getCitationRefClaimSchemaProviders } from '../../../../app-hosts/linnya/adapters/persistence/citation-ref-claims/schema-provider';
import { getConversationFilesSchemaProviders } from '../../../../app-hosts/linnya/adapters/persistence/conversation-files/schema-providers';
import { getCommandApprovalsSchemaProviders } from '../../../../app-hosts/linnya/adapters/persistence/command-approvals/schema-providers';
import { getCommandCardSettlementsSchemaProviders } from '../../../../app-hosts/linnya/adapters/persistence/command-card-settlements/schema-providers';
import { getCheckpointerSchemaProviders } from '../../../../app-hosts/linnya/adapters/persistence/checkpointer/schema-providers';
import { getTelemetrySchemaProviders } from '../../../../app-hosts/linnya/adapters/telemetry/schema-providers';
import { getKnowledgeBaseSchemaProviders } from '../../../../features/knowledge-base/infrastructure/sqlite/schema-providers';
import { getWorkspaceSchemaProviders } from '../../../../features/workspace/infrastructure/sqlite/schema-providers';
import { getAssetSchemaProviders } from '../../../../domains/assets/features/asset-ledger/infrastructure/sqlite/schemaProviders';
import { getMarkdownSchemaProviders } from '../../../../domains/markdown/features/document-storage/infrastructure/sqlite/schemaProviders';

interface ProviderDdl {
  readonly providerName: string;
  readonly ddl: string;
}

const ALLOWED_CREATE_DDL =
  /^CREATE\s+(?:(?:UNIQUE\s+)?INDEX|TABLE|TRIGGER|VIEW|VIRTUAL\s+TABLE)\s+IF\s+NOT\s+EXISTS\b/i;

const FORBIDDEN_STATEMENT_START = /^(?:ALTER\s+TABLE|DROP|INSERT|UPDATE|DELETE|PRAGMA)\b/i;

function getCoreSchemaProviders(): ISchemaProvider[] {
  return [
    ...getWorkspaceSchemaProviders(),
    ...getAssetSchemaProviders(),
    ...getMarkdownSchemaProviders(),
    ...getConversationSchemaProviders(),
    ...getCitationRefClaimSchemaProviders(),
    ...getConversationFilesSchemaProviders(),
    ...getCommandApprovalsSchemaProviders(),
    ...getCommandCardSettlementsSchemaProviders(),
    ...getCheckpointerSchemaProviders(),
    ...getTelemetrySchemaProviders(),
    ...getKnowledgeBaseSchemaProviders(),
  ];
}

function stripLeadingSqlComments(sql: string): string {
  let remaining = sql.trimStart();
  let changed = true;

  while (changed) {
    changed = false;

    if (remaining.startsWith('--')) {
      const lineEnd = remaining.indexOf('\n');
      remaining = lineEnd === -1 ? '' : remaining.slice(lineEnd + 1).trimStart();
      changed = true;
      continue;
    }

    if (remaining.startsWith('/*')) {
      const blockEnd = remaining.indexOf('*/');
      remaining = blockEnd === -1 ? '' : remaining.slice(blockEnd + 2).trimStart();
      changed = true;
    }
  }

  return remaining;
}

function listProviderDdls(): ProviderDdl[] {
  return getCoreSchemaProviders().flatMap(provider =>
    provider.getSchema().map(ddl => ({
      providerName: provider.name,
      ddl,
    }))
  );
}

function formatDdlError(entry: ProviderDdl): string {
  return `provider=${entry.providerName}\n${entry.ddl}`;
}

describe('core schema-provider DDL contract', () => {
  it('only exposes idempotent create-only DDL', () => {
    const entries = listProviderDdls();

    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const normalizedDdl = stripLeadingSqlComments(entry.ddl);
      const message = formatDdlError(entry);

      expect(normalizedDdl, message).toMatch(ALLOWED_CREATE_DDL);
      // 只拦截语句开头的数据/迁移语句；DDL 内合法的外键 `ON DELETE ...` 不属于执行期数据删除。
      expect(normalizedDdl, message).not.toMatch(FORBIDDEN_STATEMENT_START);
    }
  });

  it('covers known workspace DDL so the guard cannot silently scan an empty set', () => {
    const allDdl = listProviderDdls().map(entry => stripLeadingSqlComments(entry.ddl));

    expect(allDdl.some(ddl => /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+projects\b/i.test(ddl))).toBe(
      true
    );
    expect(
      allDdl.some(ddl => /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+workspace_nodes\b/i.test(ddl))
    ).toBe(true);
    expect(allDdl.some(ddl => /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+assets\b/i.test(ddl))).toBe(
      true
    );
    expect(
      allDdl.some(ddl => /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+document_versions\b/i.test(ddl))
    ).toBe(true);
    expect(
      allDdl.some(ddl =>
        /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+markdown_block_pending_revisions\b/i.test(ddl)
      )
    ).toBe(true);
    expect(
      allDdl.some(ddl =>
        /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+conversation_directory_cleanup_jobs\b/i.test(ddl)
      )
    ).toBe(true);
    expect(
      allDdl.some(ddl =>
        /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+conversation_citation_ref_claims\b/i.test(ddl)
      )
    ).toBe(true);
    expect(
      allDdl.some(ddl =>
        /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+conversation_command_approvals\b/i.test(ddl)
      )
    ).toBe(true);
  });
});
