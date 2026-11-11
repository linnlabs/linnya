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
 *   LINNYA_CLI_CONNECTION_FILE=<实例连接文件> node scripts/benchmark/tags-semantic/run.mjs \
 *     --model <model_config_id> --label deepseek --db <实例 workspace.sqlite> --output <新目录>
 * Shell 命令审批按“本对话允许”自动通过（只有 linnya CLI 与只读命令会出现），其他交互不代答。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCUMENTS, FIXTURE_PROJECT_NAME } from './fixture.mjs';
import { semanticSnapshot, workspaceTagCount } from './semanticSnapshot.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliEntry = path.join(repoRoot, 'apps/linnya-cli/src/main.ts');
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
  for (const key of ['model', 'label', 'db', 'output']) {
    if (!options[key]) throw new Error(`缺少 --${key}`);
  }
  return options;
}

function cli(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      const text = (code === 0 ? stdout : stderr || stdout).trim();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = undefined; }
      if (code !== 0 || !parsed?.ok) {
        reject(new Error(`linnya ${args[0]} 失败：${text.slice(0, 600)}`));
        return;
      }
      resolve(parsed);
    });
  });
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
  let run = null;
  while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
    await sleep(POLL_MS);
    ({ run } = await cli(['status', receipt.conversation_id, '--run', receipt.run_id]));
    if (!run) continue;
    for (const approval of run.command_approvals.filter(item => item.status === 'awaiting_reply')) {
      const choice = approval.available_choices.includes('allow_for_conversation') ? 'allow_for_conversation' : 'allow_once';
      await cli(['approval-reply', receipt.conversation_id, '--run', receipt.run_id,
        '--request', approval.approval_request_id, '--choice', choice]);
      approvals.push({ command: approval.command, reasons: approval.reasons, choice });
    }
    if (run.pending_interaction) {
      // 不代答：记录后停止这一步。
      interactions.push(run.pending_interaction);
      await cli(['stop', receipt.conversation_id, '--run', receipt.run_id, '--reason', 'benchmark: unexpected interaction']);
      break;
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) break;
  }
  const timedOut = !run || !['completed', 'failed', 'cancelled'].includes(run.status);
  if (timedOut && interactions.length === 0) {
    await cli(['stop', receipt.conversation_id, '--run', receipt.run_id, '--reason', 'benchmark timeout']).catch(() => {});
  }
  const result = await cli(['result', receipt.conversation_id, '--run', receipt.run_id]).catch(error => ({ error: String(error) }));
  await sleep(1_500);
  const audit = await cli(['audit', receipt.conversation_id, '--run', receipt.run_id]).catch(error => ({ error: String(error) }));
  return {
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
  };
}

/** 给已跑完的结果补上 shellCommands（实例需在运行）。 */
async function backfill(dir) {
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
    await backfill(process.argv[3]);
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const output = path.resolve(options.output);
  if (existsSync(path.join(output, 'run.json'))) throw new Error(`${output} 已有结果，换一个新目录`);
  mkdirSync(output, { recursive: true });

  const existingTags = workspaceTagCount(options.db);
  if (existingTags > 0 && options['allow-existing-tags'] !== 'yes') {
    throw new Error(`工作区已有 ${existingTags} 个标签；基准需要干净工作区（换实例或重新 clone），否则加 --allow-existing-tags yes`);
  }
  const models = await cli(['models']);
  const model = models.chat.find(item => item.model_config_id === options.model);
  if (!model?.available) throw new Error(`模型 ${options.model} 不可用：${model?.unavailable_reason ?? '未找到'}`);
  await cli(['audit', 'level', 'response']);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const context = {
    db: options.db,
    model: options.model,
    tagsProjectId: await seedProject(`${FIXTURE_PROJECT_NAME} · ${options.label} ${stamp}`),
    controlProjectId: await seedProject(`${FIXTURE_PROJECT_NAME} · 对照 ${options.label} ${stamp}`),
    conversations: {},
  };
  const record = {
    schemaVersion: 1,
    label: options.label,
    model: { id: model.model_config_id, name: model.model_name, display: model.display_name },
    startedAt: new Date().toISOString(),
    tagsProjectId: context.tagsProjectId,
    controlProjectId: context.controlProjectId,
    initial: semanticSnapshot(options.db, [context.tagsProjectId, context.controlProjectId]),
    tasks: [],
  };
  const save = () => writeFileSync(path.join(output, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  save();
  const only = options.only ? new Set(options.only.split(',')) : null;
  for (const task of TASKS) {
    if (only && !only.has(task.key)) continue;
    process.stderr.write(`[tags-bench] ${options.label} ${task.key} …\n`);
    try {
      record.tasks.push(await runTask(task, context));
    } catch (error) {
      record.tasks.push({ key: task.key, runnerError: String(error) });
    }
    save();
  }
  record.finishedAt = new Date().toISOString();
  save();
  process.stdout.write(`${JSON.stringify({ ok: true, output, tasks: record.tasks.map(task => [task.key, task.status ?? task.runnerError]) })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
