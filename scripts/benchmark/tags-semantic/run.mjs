#!/usr/bin/env node
/**
 * 标签基准驱动：在一个干净工作区（还没有任何标签）里，用指定模型依次跑
 *   control  对照项目（同样资料，从不打标签），问“定稿文稿和作者”——只能搜索、读文件
 *   oneoff   一次性问题（哪些访谈提到价格）——不该打标签、不该保存筛选
 *   organize 整理项目（场景：整理）
 *   track    跟踪文稿进度（场景：跟踪），接着 organize 的对话
 *   query    新对话问“定稿文稿和作者”——应能用 linnya query 直接查
 * 每步结束后只读快照工作区的标签、字段与保存的筛选，记下回答与审计 token。
 *
 * 用法：
 *   node scripts/benchmark/tags-semantic/run.mjs --model <model_config_id> --label deepseek --output <新目录>
 * 默认启动或复用当前 checkout 的隔离探针实例（--probe-name，默认 tags-bench），不碰日常开发实例与 _dev_data；
 * 要用其他实例必须同时显式给出 --connection-file 与 --db。
 * Shell 命令审批只对白名单命令（linnya CLI 与只读查看）按“允许一次”放行；遇到白名单外的命令立即停止这一轮并报告。
 * 审计默认级别临时改为 response，结束、出错或被中断时改回原级别。其他交互不代答。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCUMENTS, FIXTURE_PROJECT_NAME } from './fixture.mjs';
import { semanticSnapshot, workspaceTagCount } from './semanticSnapshot.mjs';
import { createAuditLevelGuard, decideCommandApproval, externalApprovalRefusal, resolveBenchmarkTarget } from './benchmarkSafety.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliEntry = path.join(repoRoot, 'apps/linnya-cli/src/main.ts');
const probeEntry = path.join(repoRoot, 'scripts/development/features/desktop-probe/bin/probe.mjs');
const TASK_TIMEOUT_MS = 12 * 60_000;
const POLL_MS = 2_000;

export const TASKS = [
  { key: 'control', project: 'control', conversation: 'new',
    prompt: '列出这个项目里所有已经定稿的文稿，以及每篇的作者。' },
  { key: 'oneoff', project: 'tags', conversation: 'new',
    prompt: '这个项目的访谈纪要里，哪些提到了价格？列出文件名就行。' },
  { key: 'organize', project: 'tags', conversation: 'new',
    prompt: '这个项目的资料有点乱，帮我整理一下：按资料类型分清楚，文稿要能看出写到哪一步了、是谁写的。不用问我，直接做。' },
  { key: 'track', project: 'tags', conversation: 'organize',
    prompt: '以后我要经常跟踪这几篇文稿的进度，帮我做一个能按进度看的视图。' },
  { key: 'query', project: 'tags', conversation: 'new',
    prompt: '列出这个项目里所有已经定稿的文稿，以及每篇的作者。' },
];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数 ${token}`);
    options[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function requireOptions(options, keys) {
  for (const key of keys) {
    if (!options[key]) throw new Error(`缺少 --${key}`);
  }
}

/** 所有 CLI 调用都显式指向选定实例的连接文件，不继承环境里的 LINNYA_CLI_CONNECTION_FILE。 */
let connectionFile;

function runJson(args, { timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ code, text: (code === 0 ? stdout : stderr || stdout).trim() });
    });
  });
}

async function cli(args, { timeoutMs = 120_000 } = {}) {
  if (!connectionFile) throw new Error('还没有选定基准实例');
  const { code, text } = await runJson(['--import', 'tsx', cliEntry, ...args], {
    timeoutMs, env: { ...process.env, LINNYA_CLI_CONNECTION_FILE: connectionFile },
  });
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (code !== 0 || !parsed?.ok) throw new Error(`linnya ${args[0]} 失败：${text.slice(0, 600)}`);
  return parsed;
}

/** 启动或复用当前 checkout 的隔离探针实例；探针每次输出一行 JSON。 */
async function startProbe(name) {
  const { text } = await runJson([probeEntry, 'up', '--name', name], { timeoutMs: 10 * 60_000, env: process.env });
  let result;
  try { result = JSON.parse(text.split('\n').at(-1)); } catch { result = undefined; }
  if (!result?.ok || !result.connectionFile || !result.workspaceDb) throw new Error(`探针实例 ${name} 启动失败：${text.slice(0, 600)}`);
  return { connectionFile: result.connectionFile, workspaceDb: result.workspaceDb };
}

async function selectTarget(options) {
  if (process.env.LINNYA_CLI_CONNECTION_FILE && !options['connection-file']) {
    process.stderr.write('[tags-bench] 忽略环境变量 LINNYA_CLI_CONNECTION_FILE；指定实例请用 --connection-file 与 --db\n');
  }
  const target = await resolveBenchmarkTarget(options, { startProbe });
  connectionFile = target.connectionFile;
  process.stderr.write(`[tags-bench] 目标实例：${target.kind === 'probe' ? `探针 ${target.name}` : '显式指定'}（${target.workspaceDb}）\n`);
  return target;
}

/** 命令不能自动放行（白名单外，或实例不允许命令行代批）：停止这一轮，整个基准也随之停止。 */
class CommandOutsideAllowlist extends Error {
  constructor(blocked) {
    super(`命令没有放行：${blocked.command}（${blocked.reason}）`);
    this.blocked = blocked;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function seedProject(name) {
  const { project } = await cli(['projects', 'create', name]);
  for (const doc of DOCUMENTS) {
    await cli(['tools', 'call', 'write_file', '--project', project.project_id,
      '--args-json', JSON.stringify({ locator: `workspace:/${doc.name}`, content: doc.content })]);
  }
  return project.project_id;
}

function messageText(message) {
  if (!message) return '';
  const parts = [];
  const visit = value => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (['content', 'text', 'markdown', 'parts', 'blocks', 'body'].includes(key)) visit(inner);
      }
    }
  };
  visit(message);
  return parts.join('\n');
}

/** 这一轮执行过的 Shell 命令原文（从会话消息里取，审计只记执行结果）。 */
async function shellCommandsOf(conversationId, runId) {
  const { messages } = await cli(['messages', conversationId, '--limit', '200']);
  const commands = [];
  for (const message of messages) {
    if (!String(message.message_id ?? '').includes(runId)) continue;
    for (const match of JSON.stringify(message).matchAll(/"command":"((?:[^"\\]|\\.)*)"/g)) {
      commands.push(JSON.parse(`"${match[1]}"`));
    }
  }
  return [...new Set(commands)];
}

async function runTask(task, context) {
  const projectId = task.project === 'tags' ? context.tagsProjectId : context.controlProjectId;
  const conversationId = task.conversation === 'new' ? undefined : context.conversations[task.conversation];
  const sendArgs = ['send', task.prompt, '--project', projectId, '--model', context.model];
  if (conversationId) sendArgs.push('--conversation', conversationId);
  const startedAt = Date.now();
  const { receipt } = await cli(sendArgs);
  context.conversations[task.key] = receipt.conversation_id;

  const approvals = [];
  const interactions = [];
  let blocked;
  let run = null;
  context.activeRun = { conversationId: receipt.conversation_id, runId: receipt.run_id };
  while (Date.now() - startedAt < TASK_TIMEOUT_MS && !context.interrupted) {
    await sleep(POLL_MS);
    ({ run } = await cli(['status', receipt.conversation_id, '--run', receipt.run_id]));
    if (!run) continue;
    for (const approval of run.command_approvals.filter(item => item.status === 'awaiting_reply')) {
      const decision = decideCommandApproval(approval);
      if (decision.action === 'stop') {
        blocked = { command: approval.command, reason: decision.reason };
        approvals.push({ command: approval.command, reasons: approval.reasons, choice: 'stopped', stopReason: decision.reason });
        await cli(['stop', receipt.conversation_id, '--run', receipt.run_id, '--reason', 'benchmark: command outside allowlist']);
        break;
      }
      try {
        await cli(['approval-reply', receipt.conversation_id, '--run', receipt.run_id,
          '--request', approval.approval_request_id, '--choice', decision.choice]);
      } catch (error) {
        // 实例默认只让用户本人批准；这时驱动替不了人，停下并告诉评测人去哪里打开。
        const refusal = externalApprovalRefusal(error);
        if (!refusal) throw error;
        blocked = { command: approval.command, reason: refusal };
        approvals.push({ command: approval.command, reasons: approval.reasons, choice: 'stopped', stopReason: refusal });
        await cli(['stop', receipt.conversation_id, '--run', receipt.run_id, '--reason', 'benchmark: instance does not allow command-line approval']);
        break;
      }
      approvals.push({ command: approval.command, reasons: approval.reasons, choice: decision.choice });
    }
    if (blocked) break;
    if (run.pending_interaction) {
      // 不代答：记录后停止这一步。
      interactions.push(run.pending_interaction);
      await cli(['stop', receipt.conversation_id, '--run', receipt.run_id, '--reason', 'benchmark: unexpected interaction']);
      break;
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) break;
  }
  // 停下后再看一眼终态，结果里记的是停止后的状态而不是停止前最后一次轮询。
  for (let attempt = 0; blocked && attempt < 10 && !['completed', 'failed', 'cancelled'].includes(run?.status); attempt += 1) {
    await sleep(1_000);
    ({ run } = await cli(['status', receipt.conversation_id, '--run', receipt.run_id]));
  }
  const timedOut = !blocked && (!run || !['completed', 'failed', 'cancelled'].includes(run.status));
  if (timedOut && interactions.length === 0) {
    await cli(['stop', receipt.conversation_id, '--run', receipt.run_id, '--reason', 'benchmark timeout']).catch(() => {});
  }
  const result = await cli(['result', receipt.conversation_id, '--run', receipt.run_id]).catch(error => ({ error: String(error) }));
  await sleep(1_500);
  const audit = await cli(['audit', receipt.conversation_id, '--run', receipt.run_id]).catch(error => ({ error: String(error) }));
  context.activeRun = undefined;
  const outcome = {
    key: task.key,
    prompt: task.prompt,
    conversationId: receipt.conversation_id,
    runId: receipt.run_id,
    status: run?.status ?? 'unknown',
    timedOut,
    error: run?.error,
    durationMs: Date.now() - startedAt,
    approvals,
    interactions,
    shellCommands: await shellCommandsOf(receipt.conversation_id, receipt.run_id).catch(error => [`<error ${error}>`]),
    answer: result.result_status === 'available' ? messageText(result.message) : null,
    audit: audit.error ? { error: audit.error } : {
      llm: audit.llm,
      tools: audit.tools,
      commands: audit.commands?.by_execution,
    },
    snapshot: semanticSnapshot(context.db, [context.tagsProjectId, context.controlProjectId]),
    ...(blocked ? { blocked } : {}),
  };
  if (blocked) throw Object.assign(new CommandOutsideAllowlist(blocked), { outcome });
  return outcome;
}

/** 给已跑完的结果补上 shellCommands（实例需在运行）。 */
async function backfill(dir, options) {
  await selectTarget(options);
  const file = path.join(path.resolve(dir), 'run.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  for (const task of record.tasks) {
    if (task.conversationId && !task.shellCommands) task.shellCommands = await shellCommandsOf(task.conversationId, task.runId);
  }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, tasks: record.tasks.map(task => [task.key, task.shellCommands?.length]) })}\n`);
}

async function main() {
  if (process.argv[2] === '--backfill') {
    await backfill(process.argv[3], parseArgs(process.argv.slice(4)));
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  requireOptions(options, ['model', 'label', 'output']);
  const output = path.resolve(options.output);
  if (existsSync(path.join(output, 'run.json'))) throw new Error(`${output} 已有结果，换一个新目录`);
  const target = await selectTarget(options);
  mkdirSync(output, { recursive: true });

  const existingTags = workspaceTagCount(target.workspaceDb);
  if (existingTags > 0 && options['allow-existing-tags'] !== 'yes') {
    throw new Error(`工作区已有 ${existingTags} 个标签；基准需要干净工作区（换实例或重新 clone），否则加 --allow-existing-tags yes`);
  }
  const models = await cli(['models']);
  const model = models.chat.find(item => item.model_config_id === options.model);
  if (!model?.available) throw new Error(`模型 ${options.model} 不可用：${model?.unavailable_reason ?? '未找到'}`);

  const audit = createAuditLevelGuard({
    read: async () => (await cli(['audit', 'level'])).level,
    write: level => cli(['audit', 'level', level]),
  });
  const context = { db: target.workspaceDb, model: options.model, conversations: {}, activeRun: undefined, interrupted: undefined };
  let record;
  const save = () => { if (record) writeFileSync(path.join(output, 'run.json'), `${JSON.stringify(record, null, 2)}\n`); };

  // 中断时：停掉正在跑的这一轮（否则它会一直等审批），改回审计级别，保存已有结果再退出。
  const onSignal = (signal, exitCode) => {
    if (context.interrupted) return;
    context.interrupted = signal;
    process.stderr.write(`[tags-bench] 收到 ${signal}，停止当前一轮并还原审计级别…\n`);
    const active = context.activeRun;
    const stopActive = active
      ? cli(['stop', active.conversationId, '--run', active.runId, '--reason', `benchmark interrupted (${signal})`]).catch(() => {})
      : Promise.resolve();
    stopActive
      .then(() => audit.restore())
      .catch(error => process.stderr.write(`[tags-bench] 审计级别还原失败，原级别 ${audit.original}：${error}\n`))
      .finally(() => {
        if (record) { record.interrupted = signal; record.auditLevel = { original: audit.original }; save(); }
        process.exit(exitCode);
      });
  };
  process.on('SIGINT', () => onSignal('SIGINT', 130));
  process.on('SIGTERM', () => onSignal('SIGTERM', 143));

  const stopped = await audit.run('response', async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    context.tagsProjectId = await seedProject(`${FIXTURE_PROJECT_NAME} · ${options.label} ${stamp}`);
    context.controlProjectId = await seedProject(`${FIXTURE_PROJECT_NAME} · 对照 ${options.label} ${stamp}`);
    record = {
      schemaVersion: 1,
      label: options.label,
      target: { kind: target.kind, ...(target.name ? { probeName: target.name } : {}), workspaceDb: target.workspaceDb },
      model: { id: model.model_config_id, name: model.model_name, display: model.display_name },
      startedAt: new Date().toISOString(),
      tagsProjectId: context.tagsProjectId,
      controlProjectId: context.controlProjectId,
      initial: semanticSnapshot(target.workspaceDb, [context.tagsProjectId, context.controlProjectId]),
      tasks: [],
    };
    save();
    const only = options.only ? new Set(options.only.split(',')) : null;
    for (const task of TASKS) {
      if (context.interrupted) break;
      if (only && !only.has(task.key)) continue;
      process.stderr.write(`[tags-bench] ${options.label} ${task.key} …\n`);
      try {
        record.tasks.push(await runTask(task, context));
      } catch (error) {
        if (error instanceof CommandOutsideAllowlist) {
          record.tasks.push(error.outcome);
          record.stopped = { task: task.key, ...error.blocked };
          save();
          return record.stopped;
        }
        record.tasks.push({ key: task.key, runnerError: String(error) });
      }
      save();
    }
    return undefined;
  });
  record.auditLevel = { original: audit.original, restored: true };
  record.finishedAt = new Date().toISOString();
  save();
  process.stdout.write(`${JSON.stringify({
    ok: !stopped, output, tasks: record.tasks.map(task => [task.key, task.status ?? task.runnerError]),
    ...(stopped ? { stopped } : {}),
  })}\n`);
  if (stopped) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
