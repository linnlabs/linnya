import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DatabaseService } from '../../src/electron-main/services/database';
import {
  findConversationsNeedingUiProjectionRebuild,
  rebuildConversationUiProjection,
  type ConversationUiProjectionRebuildResult,
} from '../../src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/rebuildConversation';

interface CliOptions {
  readonly dbPath: string;
  readonly conversationId: string | null;
  readonly force: boolean;
}

interface ConversationIdRow {
  conversation_id: string;
}

interface BackfillSummary {
  readonly dbPath: string;
  readonly force: boolean;
  readonly conversationId: string | null;
  readonly scannedConversations: number;
  readonly rebuiltConversations: number;
  readonly skippedConversations: number;
  readonly totalMessages: number;
  readonly totalDurationMs: number;
  readonly maxConversationCostMs: number;
  readonly results: readonly ConversationUiProjectionRebuildResult[];
}

function readOptions(argv: readonly string[]): CliOptions {
  const dbArg = argv.find(arg => arg.startsWith('--db='));
  const conversationArg = argv.find(arg => arg.startsWith('--conversation='));
  return {
    dbPath: dbArg
      ? path.resolve(dbArg.slice('--db='.length))
      : path.join(process.cwd(), '_dev_data', 'workspace', 'workspace.sqlite'),
    conversationId: conversationArg ? conversationArg.slice('--conversation='.length) : null,
    force: argv.includes('--force'),
  };
}

function readConversationIdsForForce(db: Database.Database): string[] {
  return db
    .prepare<unknown[], ConversationIdRow>(`
      SELECT conversation_id
      FROM conversations
      ORDER BY last_event_at DESC, conversation_id ASC
    `)
    .all()
    .map(row => row.conversation_id);
}

function readTargetConversationIds(db: Database.Database, options: CliOptions): string[] {
  if (options.conversationId) {
    return [options.conversationId];
  }
  if (options.force) {
    return readConversationIdsForForce(db);
  }
  return findConversationsNeedingUiProjectionRebuild(db).map(candidate => candidate.conversationId);
}

function main(): void {
  const options = readOptions(process.argv.slice(2));
  if (!fs.existsSync(options.dbPath)) {
    throw new Error(`workspace sqlite not found: ${options.dbPath}`);
  }

  const databaseService = new DatabaseService(options.dbPath);
  const start = Date.now();
  let summary: BackfillSummary | null = null;
  try {
    databaseService.initialize();
    const db = databaseService.getDb();
    const conversationIds = readTargetConversationIds(db, options);
    const results: ConversationUiProjectionRebuildResult[] = [];
    for (const conversationId of conversationIds) {
      results.push(rebuildConversationUiProjection(db, conversationId, { force: options.force }));
    }

    const rebuilt = results.filter(result => result.status === 'rebuilt');
    const skipped = results.filter(result => result.status === 'skipped');
    const maxConversationCostMs = rebuilt.reduce(
      (max, result) => Math.max(max, result.durationMs),
      0,
    );
    const totalMessages = rebuilt.reduce(
      (sum, result) => sum + result.messageCount,
      0,
    );

    summary = {
      dbPath: options.dbPath,
      force: options.force,
      conversationId: options.conversationId,
      scannedConversations: conversationIds.length,
      rebuiltConversations: rebuilt.length,
      skippedConversations: skipped.length,
      totalMessages,
      totalDurationMs: Date.now() - start,
      maxConversationCostMs,
      results,
    };
  } finally {
    databaseService.close();
  }

  if (summary) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

main();
