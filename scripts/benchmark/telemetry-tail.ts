#!/usr/bin/env node
/**
 * @file scripts/benchmark/telemetry-tail.ts
 * @description 便捷脚本：查最近的 engine_telemetry 事件。
 *
 * 用法：
 *   npm run telemetry:tail                 # 默认查最近 20 条
 *   npm run telemetry:tail -- --limit=50
 *   npm run telemetry:tail -- --kind=llm_call
 *   npm run telemetry:tail -- --conv=conv_abc
 *   npm run telemetry:tail -- --db=/path/to/workspace.sqlite
 *
 * 数据库路径解析顺序：
 *   1. --db=<path> 显式参数
 *   2. 环境变量 LINNYA_TELEMETRY_DB
 *   3. dev 模式默认路径：<projectRoot>/_dev_data/workspace/workspace.sqlite
 *
 * 生产模式数据库通常在 ~/Library/Application Support/<AppName>/AIService/...，
 * 路径需要用户手动通过 --db 指定（不同打包名不同）。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface CliArgs {
  limit: number;
  kind?: string;
  conv?: string;
  db?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 20 };
  for (const raw of argv.slice(2)) {
    if (raw === '--' || raw === '') continue;
    const [key, value] = raw.replace(/^--/, '').split('=', 2);
    switch (key) {
      case 'limit':
        args.limit = Number(value) || 20;
        break;
      case 'kind':
        args.kind = value;
        break;
      case 'conv':
        args.conv = value;
        break;
      case 'db':
        args.db = value;
        break;
      case 'help':
      case 'h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown arg: --${key}`);
        printHelp();
        process.exit(1);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(
    [
      'telemetry-tail: 查最近的 engine_telemetry 事件',
      '',
      '用法:',
      '  npm run telemetry:tail',
      '  npm run telemetry:tail -- --limit=50',
      '  npm run telemetry:tail -- --kind=llm_call',
      '  npm run telemetry:tail -- --conv=conv_abc',
      '  npm run telemetry:tail -- --db=/path/to/workspace.sqlite',
    ].join('\n'),
  );
}

function resolveDbPath(args: CliArgs): string {
  if (args.db) return path.resolve(args.db);
  if (process.env.LINNYA_TELEMETRY_DB) {
    return path.resolve(process.env.LINNYA_TELEMETRY_DB);
  }
  // 开发模式默认：<repoRoot>/_dev_data/workspace/workspace.sqlite
  const repoRoot = process.cwd();
  return path.join(repoRoot, '_dev_data', 'workspace', 'workspace.sqlite');
}

interface TelemetryRow {
  id: number;
  event_kind: string;
  conversation_id: string | null;
  run_id: string | null;
  turn_id: string | null;
  step_id: string | null;
  duration_ms: number | null;
  payload: string;
  emitted_at: number;
}

function formatRow(row: TelemetryRow): string {
  const time = new Date(row.emitted_at).toISOString();
  const parts: string[] = [time, row.event_kind];
  if (row.duration_ms !== null) parts.push(`${row.duration_ms}ms`);
  if (row.conversation_id) parts.push(`conv=${row.conversation_id}`);
  if (row.run_id) parts.push(`run=${row.run_id}`);

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    /* 容错：payload 不是合法 JSON 就空对象 */
  }

  switch (row.event_kind) {
    case 'llm_call':
      if (typeof payload.modelId === 'string') parts.push(`model=${payload.modelId}`);
      if (payload.usage && typeof payload.usage === 'object') {
        const usage = payload.usage as Record<string, unknown>;
        parts.push(`tokens=${usage.promptTokens}+${usage.completionTokens}`);
      }
      break;
    case 'tool_call':
      if (typeof payload.toolName === 'string') parts.push(`name=${payload.toolName}`);
      if (typeof payload.ok === 'boolean') parts.push(`ok=${payload.ok}`);
      if (typeof payload.errorCode === 'string') parts.push(`error=${payload.errorCode}`);
      break;
    case 'context_compaction':
      if (typeof payload.modelId === 'string') parts.push(`model=${payload.modelId}`);
      if (typeof payload.outcome === 'string') parts.push(`outcome=${payload.outcome}`);
      if (typeof payload.compactionIndex === 'number') {
        const max = typeof payload.maxCompactionsPerRun === 'number'
          ? `/${payload.maxCompactionsPerRun}`
          : '';
        parts.push(`index=${payload.compactionIndex}${max}`);
      }
      if (typeof payload.beforeTokens === 'number') {
        parts.push(`before=${payload.beforeTokens}`);
      }
      if (typeof payload.afterTokens === 'number') parts.push(`after=${payload.afterTokens}`);
      if (typeof payload.suppressedReason === 'string') {
        parts.push(`reason=${payload.suppressedReason}`);
      }
      if (typeof payload.errorCode === 'string') parts.push(`error=${payload.errorCode}`);
      break;
    case 'graph_node':
      if (typeof payload.nodeId === 'string') parts.push(`node=${payload.nodeId}`);
      break;
    case 'run_lifecycle':
      if (typeof payload.phase === 'string') parts.push(`phase=${payload.phase}`);
      if (typeof payload.stepsUsed === 'number' && typeof payload.maxSteps === 'number') {
        parts.push(`steps=${payload.stepsUsed}/${payload.maxSteps}`);
      }
      if (typeof payload.terminalReason === 'string') {
        parts.push(`terminal=${payload.terminalReason}`);
      }
      break;
  }

  return parts.join('  ');
}

function main(): void {
  const args = parseArgs(process.argv);
  const dbPath = resolveDbPath(args);

  if (!fs.existsSync(dbPath)) {
    console.error(`数据库文件不存在: ${dbPath}`);
    console.error('');
    console.error('提示:');
    console.error('  - 开发模式默认路径: <repoRoot>/_dev_data/workspace/workspace.sqlite');
    console.error('  - 生产模式路径需要手动指定:');
    console.error(
      `    macOS: ~/Library/Application Support/<AppName>/AIService/workspace/workspace.sqlite`,
    );
    console.error(`    用 --db=<path> 或环境变量 LINNYA_TELEMETRY_DB 指定`);
    process.exit(1);
  }

  console.log(`# 数据库: ${dbPath.replace(os.homedir(), '~')}`);

  const db = new Database(dbPath, { readonly: true });
  try {
    // 先确认表存在，避免给出难看的错
    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='engine_telemetry'",
      )
      .get();
    if (!tableExists) {
      console.error('表 engine_telemetry 不存在——可能是该数据库还没启动过应用初始化 schema。');
      process.exit(1);
    }

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (args.kind) {
      where.push('event_kind = ?');
      params.push(args.kind);
    }
    if (args.conv) {
      where.push('conversation_id = ?');
      params.push(args.conv);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(args.limit);

    const rows = db
      .prepare<typeof params, TelemetryRow>(
        `SELECT * FROM engine_telemetry ${whereClause} ORDER BY emitted_at DESC LIMIT ?`,
      )
      .all(...params);

    if (rows.length === 0) {
      console.log('# 没有匹配的事件');
      return;
    }

    console.log(`# 显示最近 ${rows.length} 条（按 emitted_at 倒序）`);
    console.log('');
    // 倒序后再翻一下变正序，更易读（最新在最下面，跟 tail -f 一致）
    for (const row of rows.reverse()) {
      console.log(formatRow(row));
    }
  } finally {
    db.close();
  }
}

main();
