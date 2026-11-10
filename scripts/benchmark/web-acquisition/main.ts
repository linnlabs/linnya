/**
 * 信息获取基准：生成批次 manifest，或只读分析一个批次。
 *
 *   pnpm benchmark:web-acquisition manifest --model ID [--keys a,b] [--runs 1] [--output FILE]
 *   pnpm benchmark:agent slides-design-batch --manifest FILE --output DIR   # 通用批次 runner
 *   pnpm benchmark:web-acquisition analyze --batch DIR [--database FILE]
 *
 * 分析只读打开工作区数据库（sqlite3 -readonly），按会话核对每题的必须取得项，不打质量分。
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { evaluateWebAcquisitionRun, type ToolCallFact, type UsageFact, type WebAcquisitionRunMetrics } from './evaluate';
import { WEB_ACQUISITION_TASKS } from './tasks';

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../../..');

function parseArgs(argv: readonly string[]): { command: string; values: Map<string, string> } {
  const [command = '', ...rest] = argv.filter(arg => arg !== '--');
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]!;
    const value = rest[index + 1];
    if (!key.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${key}`);
    values.set(key.slice(2), value);
  }
  return { command, values };
}

async function writeManifest(values: Map<string, string>): Promise<void> {
  const model = values.get('model');
  if (!model) throw new Error('manifest needs --model; the benchmark compares runs on a fixed model');
  const keys = values.get('keys')?.split(',').map(key => key.trim()).filter(Boolean);
  const tasks = keys ? keys.map(key => {
    const task = WEB_ACQUISITION_TASKS.find(candidate => candidate.key === key);
    if (!task) throw new Error(`Unknown task: ${key}`);
    return task;
  }) : WEB_ACQUISITION_TASKS;
  const manifest = {
    schema_version: 1,
    name: values.get('name') ?? `web-acquisition ${new Date().toISOString().slice(0, 10)}`,
    agent: values.get('agent') ?? 'default',
    model,
    reasoning: values.get('reasoning') ?? 'high',
    concurrency: Number(values.get('concurrency') ?? 3),
    timeout_minutes: Number(values.get('timeout') ?? 20),
    max_approvals: 2,
    briefs: tasks.map(task => ({ key: task.key, prompt: task.prompt, runs: Number(values.get('runs') ?? 1) })),
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const output = values.get('output');
  if (output) await writeFile(path.resolve(output), text);
  else process.stdout.write(text);
}

async function query<T>(database: string, sql: string): Promise<T[]> {
  const { stdout } = await run('sqlite3', ['-readonly', '-json', database, sql], { maxBuffer: 1024 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) as T[] : [];
}

const quote = (value: string) => `'${value.replace(/'/gu, "''")}'`;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 决策事件给参数，输出事件给终态与正文；两者按 run + tool_call_id 配对。 */
async function readToolCalls(database: string, conversationId: string): Promise<ToolCallFact[]> {
  const rows = await query<{ runId: string; type: string; payload: string }>(database, `
    SELECT e.run_id AS runId, e.type AS type, e.payload AS payload FROM events e JOIN runs r ON r.id = e.run_id
    WHERE r.conversation_id = ${quote(conversationId)} AND e.type IN ('tool_call_decision', 'tool_output') ORDER BY e.ts, e.rowid`);
  const calls = new Map<string, { runId: string; toolName: string; arguments: string; status: ToolCallFact['status']; errorCode?: string; observation: string; data?: unknown }>();
  for (const row of rows) {
    const payload = record(JSON.parse(row.payload));
    if (row.type === 'tool_call_decision') {
      const inner = record(payload.payload);
      const toolCalls = Array.isArray(inner.tool_calls) ? inner.tool_calls : [];
      for (const toolCall of toolCalls) {
        const fn = record(record(toolCall).function);
        const id = String(record(toolCall).id ?? payload.tool_call_id ?? '');
        calls.set(`${row.runId}\u0000${id}`, {
          runId: row.runId, toolName: String(fn.name ?? payload.tool_name ?? ''), arguments: String(fn.arguments ?? ''), status: null, observation: '',
        });
      }
      if (!toolCalls.length && payload.tool_call_id) {
        calls.set(`${row.runId}\u0000${String(payload.tool_call_id)}`, {
          runId: row.runId, toolName: String(payload.tool_name ?? ''), arguments: JSON.stringify(inner.args ?? payload.args ?? {}), status: null, observation: '',
        });
      }
      continue;
    }
    const key = `${row.runId}\u0000${String(payload.tool_call_id ?? '')}`;
    const call = calls.get(key) ?? { runId: row.runId, toolName: String(payload.tool_name ?? ''), arguments: '', status: null, observation: '' };
    call.status = payload.status === 'success' ? 'success' : 'error';
    if (typeof payload.error_code === 'string') call.errorCode = payload.error_code;
    call.observation = typeof payload.observation === 'string' ? payload.observation : JSON.stringify(payload.observation ?? '');
    call.data = typeof payload.data === 'string' ? safeJson(payload.data) : payload.data;
    calls.set(key, call);
  }
  return [...calls.values()];
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

async function readUsage(database: string, conversationId: string): Promise<UsageFact> {
  const rows = await query<{ payload: string }>(database, `
    SELECT payload FROM engine_telemetry WHERE event_kind = 'llm_call' AND payload LIKE ${quote(`%${conversationId}%`)}`);
  const usage = { calls: 0, uncachedInput: 0, cachedInput: 0, output: 0, listCostUsd: 0 };
  for (const row of rows) {
    const canonical = record(record(record(JSON.parse(row.payload)).usage).canonicalUsage);
    usage.calls += 1;
    usage.uncachedInput += Number(canonical.inputTokens ?? 0);
    usage.cachedInput += Number(canonical.cacheReadTokens ?? 0);
    usage.output += Number(canonical.outputTokens ?? 0);
    usage.listCostUsd += Number(record(record(canonical.rawUsage).opencode).list_cost ?? 0);
  }
  return usage;
}

interface BatchRun { runKey: string; briefKey: string; conversationId?: string; outcome?: string; durationMs?: number }

async function analyze(values: Map<string, string>): Promise<void> {
  const batch = values.get('batch');
  if (!batch) throw new Error('analyze needs --batch DIR');
  const database = path.resolve(values.get('database') ?? path.join(repoRoot, '_dev_data/workspace/workspace.sqlite'));
  const state = JSON.parse(await readFile(path.join(batch, 'batch.json'), 'utf8')) as { name: string; runs: BatchRun[] };
  const results: { runKey: string; task: string; outcome?: string; minutes?: number; metrics?: WebAcquisitionRunMetrics }[] = [];
  for (const entry of state.runs) {
    const task = WEB_ACQUISITION_TASKS.find(candidate => candidate.key === entry.briefKey);
    if (!task) throw new Error(`Batch run ${entry.runKey} is not a web acquisition task`);
    const minutes = entry.durationMs === undefined ? undefined : Math.round(entry.durationMs / 6000) / 10;
    if (!entry.conversationId) {
      results.push({ runKey: entry.runKey, task: task.key, outcome: entry.outcome ?? 'not_sent', minutes });
      continue;
    }
    const metrics = evaluateWebAcquisitionRun(task, await readToolCalls(database, entry.conversationId), await readUsage(database, entry.conversationId));
    results.push({ runKey: entry.runKey, task: task.key, outcome: entry.outcome, minutes, metrics });
  }
  await writeFile(path.join(batch, 'metrics.json'), `${JSON.stringify({ name: state.name, database, results }, null, 2)}\n`);
  const lines = [
    `# ${state.name}`,
    '',
    '必须取得项按会话真实工具输出核对：原文片段出现在某次成功读取里，且指定来源成功取得过。这是取得事实，不是答案质量分。',
    '',
    '| 试跑 | 结果 | 必须取得 | 搜索（带 site/语言/时间/目标） | 读取 成功/失败/截断/文件 | Shell 解析 PDF | 子任务 | LLM 调用 | 未缓存/缓存/输出 | 列表价 | 分钟 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(({ runKey, outcome, minutes, metrics }) => {
      if (!metrics) return `| ${runKey} | ${outcome ?? ''} | – | – | – | – | – | – | – | – | ${minutes ?? ''} |`;
      const passed = metrics.checks.filter(check => check.passed).length;
      const failed = metrics.checks.filter(check => !check.passed)
        .map(check => `${check.label}${check.contentRead === false ? '（未读到）' : ''}${check.sourceFetched === false ? '（来源未取得）' : ''}`);
      const condition = metrics.searchesWithConditions;
      return `| ${runKey} | ${outcome ?? ''} | ${passed}/${metrics.checks.length}${failed.length ? `：缺 ${failed.join('、')}` : ''} | ${metrics.searches}（${condition.site}/${condition.language}/${condition.recency}/${condition.objective}） | ${metrics.reads.ok}/${metrics.reads.failed}/${metrics.reads.truncated}/${metrics.reads.files} | ${metrics.shellPdfAttempts} | ${metrics.children} | ${metrics.usage.calls} | ${metrics.usage.uncachedInput}/${metrics.usage.cachedInput}/${metrics.usage.output} | $${metrics.usage.listCostUsd.toFixed(4)} | ${minutes ?? ''} |`;
    }),
    '',
  ];
  await writeFile(path.join(batch, 'summary.md'), lines.join('\n'));
  process.stdout.write(lines.join('\n'));
}

const { command, values } = parseArgs(process.argv.slice(2));
if (command === 'manifest') await writeManifest(values);
else if (command === 'analyze') await analyze(values);
else throw new Error('Usage: main.ts manifest --model ID [--keys a,b] [--runs N] [--output FILE] | analyze --batch DIR [--database FILE]');
