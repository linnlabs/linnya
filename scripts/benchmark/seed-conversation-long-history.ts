#!/usr/bin/env node
/**
 * @file scripts/benchmark/seed-conversation-long-history.ts
 * @description 写入一个可重复的长历史会话，用于 conversation 打开路径性能基线。
 *
 * 用法：
 *   npm run seed:conversation:long-history
 *   npm run seed:conversation:long-history -- --turns=6000
 *   npm run seed:conversation:long-history -- --project=<projectId>
 *   npm run seed:conversation:long-history -- --project-name=test
 *   npm run seed:conversation:long-history -- --project-name=test --attach-existing
 *   npm run seed:conversation:long-history -- --replace
 *   npm run seed:conversation:long-history -- --db=/path/to/workspace.sqlite
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { RuntimeEvent } from 'linnkit/contracts';

const DEFAULT_CONVERSATION_ID = 'conv-phase0-long-history-baseline';
const DEFAULT_TURNS = 5_000;
const PROGRESS_INTERVAL_TURNS = 250;

interface CliArgs {
  readonly conversationId: string;
  readonly turns: number;
  readonly dbPath?: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly attachExisting: boolean;
  readonly replace: boolean;
}

interface ProjectRow {
  readonly id: string;
  readonly name: string;
}

function parsePositiveInteger(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是正整数，收到：${raw ?? '(空)'}`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = new Map<string, string | true>();

  for (const raw of argv.slice(2)) {
    if (raw === '--' || raw.trim().length === 0) {
      continue;
    }

    const normalized = raw.replace(/^--/, '');
    const eqIndex = normalized.indexOf('=');
    if (eqIndex === -1) {
      args.set(normalized, true);
      continue;
    }

    args.set(normalized.slice(0, eqIndex), normalized.slice(eqIndex + 1));
  }

  if (args.has('help') || args.has('h')) {
    printHelp();
    process.exit(0);
  }

  const conversationId = getStringArg(args, 'conversation') ?? DEFAULT_CONVERSATION_ID;
  const explicitTurns = getStringArg(args, 'turns');
  const explicitEvents = getStringArg(args, 'events');
  if (explicitTurns && explicitEvents) {
    throw new Error('只能指定 --turns 或 --events 其中一个；长历史样本按一轮两条事件生成。');
  }

  const turns = explicitEvents
    ? Math.ceil(parsePositiveInteger(explicitEvents, '--events') / 2)
    : explicitTurns
      ? parsePositiveInteger(explicitTurns, '--turns')
      : DEFAULT_TURNS;

  const dbPath = getStringArg(args, 'db');
  const projectId = getStringArg(args, 'project');
  const projectName = getStringArg(args, 'project-name');
  if (projectId && projectName) {
    throw new Error('只能指定 --project 或 --project-name 其中一个。');
  }

  return {
    conversationId,
    turns,
    dbPath: dbPath ? path.resolve(dbPath) : undefined,
    projectId,
    projectName,
    attachExisting: args.get('attach-existing') === true,
    replace: args.get('replace') === true,
  };
}

function getStringArg(args: ReadonlyMap<string, string | true>, key: string): string | undefined {
  const value = args.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function printHelp(): void {
  console.log(
    [
      'seed-conversation-long-history: 写入长历史 conversation 性能样本',
      '',
      '默认写入开发库：<repo>/_dev_data/workspace/workspace.sqlite',
      '',
      '用法:',
      '  npm run seed:conversation:long-history',
      '  npm run seed:conversation:long-history -- --turns=6000',
      '  npm run seed:conversation:long-history -- --events=12000',
      '  npm run seed:conversation:long-history -- --project=<projectId>',
      '  npm run seed:conversation:long-history -- --project-name=test',
      '  npm run seed:conversation:long-history -- --project-name=test --attach-existing',
      '  npm run seed:conversation:long-history -- --conversation=<id>',
      '  npm run seed:conversation:long-history -- --replace',
      '  npm run seed:conversation:long-history -- --db=/path/to/workspace.sqlite',
    ].join('\n'),
  );
}

function buildUserEvent(
  createUserInputEvent: typeof import('linnkit/contracts').createUserInputEvent,
  conversationId: string,
  turnIndex: number,
  timestamp: number,
): RuntimeEvent {
  const padded = String(turnIndex).padStart(5, '0');
  const turnId = `turn-${padded}`;
  return createUserInputEvent(
    `event-${padded}-user`,
    conversationId,
    turnId,
    `长历史基线用户消息 ${padded}。这条消息用于测试 history loader，不依赖模型运行。`,
    { timestamp },
  );
}

function buildAnswerEvent(
  createFinalAnswerEvent: typeof import('linnkit/contracts').createFinalAnswerEvent,
  conversationId: string,
  turnIndex: number,
  timestamp: number,
): RuntimeEvent {
  const padded = String(turnIndex).padStart(5, '0');
  const turnId = `turn-${padded}`;
  return createFinalAnswerEvent(
    `answer-${padded}`,
    conversationId,
    turnId,
    [
      `长历史基线回答 ${padded}。`,
      '这是一段稳定、短小、可渲染的 Markdown 文本。',
      '目标是测量打开历史时事件读取、投影和首屏渲染成本。',
    ].join('\n\n'),
    { timestamp, completion_reason: 'terminal' },
  );
}

function assertProjectExists(db: import('better-sqlite3').Database, projectId: string): void {
  const row = db
    .prepare<[string], ProjectRow>('SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL LIMIT 1')
    .get(projectId);
  if (!row) {
    throw new Error(`指定的 project 不存在：${projectId}`);
  }
}

function resolveProjectByName(
  db: import('better-sqlite3').Database,
  projectName: string,
): ProjectRow {
  const row = db
    .prepare<[string], ProjectRow>('SELECT id, name FROM projects WHERE name = ? AND deleted_at IS NULL LIMIT 1')
    .get(projectName);

  if (row) {
    return row;
  }

  const activeProjects = db
    .prepare<[], ProjectRow>('SELECT id, name FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC')
    .all();
  const projectNames = activeProjects.map(project => project.name).join(', ');
  throw new Error(
    `找不到项目：${projectName}。当前可用项目：${projectNames || '(无)'}`,
  );
}

function attachExistingConversationToProject(
  db: import('better-sqlite3').Database,
  conversationId: string,
  projectId: string,
): void {
  /**
   * 中文说明：
   * - 这里不走 delete + rebuild，因为长历史样本已经具备完整 runs/events/messages；
   * - “挂到项目下”只改变 conversations.project_id 这个归属元数据；
   * - 不碰事件事实源，避免污染 Phase 0 基线样本。
   */
  const result = db
    .prepare<[string, string]>('UPDATE conversations SET project_id = ? WHERE conversation_id = ?')
    .run(projectId, conversationId);
  if (result.changes !== 1) {
    throw new Error(`无法更新会话归属：${conversationId}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // 这个脚本默认服务开发基线；必须在动态 import DatabaseService 前设置，确保路径落到 _dev_data。
  process.env.LINNYA_DEV_MODE = process.env.LINNYA_DEV_MODE ?? 'true';

  const [
    { DatabaseService },
    { SQLiteEventStore },
    { createUserInputEvent, createFinalAnswerEvent },
  ] = await Promise.all([
    import('../../src/electron-main/services/database'),
    import('../../src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation'),
    import('linnkit/contracts'),
  ]);

  const databaseService = new DatabaseService(args.dbPath);
  databaseService.initialize();

  const db = databaseService.getDb();
  const store = new SQLiteEventStore(db);
  const totalEvents = args.turns * 2;
  const title = `[Perf] Long history baseline (${totalEvents} events)`;
  const startedAt = performance.now();

  try {
    const resolvedProject = args.projectName
      ? resolveProjectByName(db, args.projectName)
      : undefined;
    const projectId = args.projectId ?? resolvedProject?.id;
    const projectName = resolvedProject?.name;

    if (args.projectId) {
      assertProjectExists(db, args.projectId);
    }

    const existing = await store.getConversationMetadata(args.conversationId);
    if (existing && args.attachExisting) {
      if (!projectId) {
        throw new Error('--attach-existing 必须配合 --project 或 --project-name 使用。');
      }

      attachExistingConversationToProject(db, args.conversationId, projectId);
      console.log('# 已将现有长历史样本挂到项目下');
      console.log(`conversationId=${args.conversationId}`);
      console.log(`projectName=${projectName ?? '(by id)'}`);
      console.log(`projectId=${projectId}`);
      return;
    }

    if (existing && !args.replace) {
      throw new Error(
        `会话已存在：${args.conversationId}。如需重建样本，请加 --replace；如只想挂到项目下，请加 --attach-existing。`,
      );
    }

    if (existing && args.replace) {
      await store.deleteConversation(args.conversationId);
      console.log(`# 已删除旧样本: ${args.conversationId}`);
    }

    const firstEvent = buildUserEvent(createUserInputEvent, args.conversationId, 1, Date.now());
    await store.ensureConversation(args.conversationId, [firstEvent], projectId, 'agent');
    await store.updateTitle(args.conversationId, title);

    const baseTimestamp = Date.now() - args.turns * 2_000;
    for (let turnIndex = 1; turnIndex <= args.turns; turnIndex += 1) {
      const padded = String(turnIndex).padStart(5, '0');
      const runId = `run-${args.conversationId}-${padded}`;
      const session = await store.beginRunSession(args.conversationId, runId, {
        kind: 'agent',
        model_key: 'synthetic-baseline',
        toolset_version: 'conversation-phase0',
      });

      await store.appendEventToRun(
        session,
        buildUserEvent(createUserInputEvent, args.conversationId, turnIndex, baseTimestamp + turnIndex * 2_000),
      );
      await store.appendEventToRun(
        session,
        buildAnswerEvent(createFinalAnswerEvent, args.conversationId, turnIndex, baseTimestamp + turnIndex * 2_000 + 500),
      );
      await store.completeRun(session);

      if (turnIndex % PROGRESS_INTERVAL_TURNS === 0 || turnIndex === args.turns) {
        console.log(`# progress ${turnIndex}/${args.turns} turns (${turnIndex * 2}/${totalEvents} events)`);
      }
    }

    const elapsedMs = performance.now() - startedAt;
    const dbLabel = (args.dbPath ?? path.join(process.cwd(), '_dev_data', 'workspace', 'workspace.sqlite'))
      .replace(os.homedir(), '~');
    console.log('');
    console.log('# 长历史样本写入完成');
    console.log(`conversationId=${args.conversationId}`);
    console.log(`title=${title}`);
    console.log(`events=${totalEvents}`);
    console.log(`projectName=${projectName ?? '(none)'}`);
    console.log(`projectId=${projectId ?? '(none)'}`);
    console.log(`db=${dbLabel}`);
    console.log(`elapsedMs=${Math.round(elapsedMs)}`);
  } finally {
    store.close();
    if (args.dbPath && !fs.existsSync(args.dbPath)) {
      console.warn(`# 注意：指定的数据库路径不存在或已被移除：${args.dbPath}`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`# seed 失败: ${message}`);
  process.exit(1);
});
