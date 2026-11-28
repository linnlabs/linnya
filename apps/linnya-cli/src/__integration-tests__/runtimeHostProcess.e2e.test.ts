import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  ConversationControlCommandApprovalsResponseSchema,
  ConversationControlProjectsResponseSchema,
} from '@app/schemas';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startApprovalModelFixture, writeApprovalModelCatalog } from './fixtures/runtimeChatModel';

import { AGENT_ENVIRONMENT_VARIABLES } from '../functions/detectCliExecutor';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const cliEntry = path.join(repoRoot, 'apps/linnya-cli/bin/linnya.cjs');
const runtimeSuite = process.env.LINNYA_CLI_RUNTIME_E2E === '1' ? describe : describe.skip;
const temporaryRoots: string[] = [];
const liveRuntimes: ChildProcessWithoutNullStreams[] = [];
const modelServers: Server[] = [];

afterEach(async () => {
  await Promise.all(liveRuntimes.splice(0).map(async child => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await waitForClose(child).catch(() => undefined);
  }));
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fs.rm(root, { recursive: true, force: true })
  )));
  await Promise.all(modelServers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
});

runtimeSuite('built CLI Runtime -> fixed Node App Server', () => {
  it('凭据文件损坏时启动明确报错、保留原件，不泄露文件片段或发布 ready', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-credentials-e2e-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'connection.json');
    const modelCatalog = path.join(root, 'default-models.json');
    await fs.mkdir(workspace, { recursive: true });
    await writeFastMockModelCatalog(modelCatalog);
    const environment = await createRuntimeEnvironment({ connectionFile, modelCatalog });
    const credentialFile = path.join(root, 'runtime-host', '_dev_electron', 'AIService', 'config', 'credentials.json');
    const broken = '{"secret":"startup-must-not-log-this",';
    await fs.mkdir(path.dirname(credentialFile), { recursive: true });
    await fs.writeFile(credentialFile, broken, { mode: 0o600 });
    const result = await runCli(['runtime', 'start', '--workspace', workspace,
      '--qdrant-port', String(await reservePort())], environment);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('保留原文件');
    expect(result.stderr).not.toContain('startup-must-not-log-this');
    expect(await fs.readFile(credentialFile, 'utf8')).toBe(broken);
    await expect(fs.stat(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('默认只有人能批：外部提交允许被明确拒绝并留在待处理，拒绝的理由交到 Agent 手里；启动时放行后才能代批', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-approval-e2e-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'connection.json');
    const modelCatalog = path.join(root, 'default-models.json');
    const fixture = await startApprovalModelFixture();
    modelServers.push(fixture.server);
    await fs.mkdir(workspace, { recursive: true });
    await writeApprovalModelCatalog(modelCatalog, fixture.url);
    const environment = await createRuntimeEnvironment({ connectionFile, modelCatalog });
    const guarded = await startRuntime({ workspace, environment });
    const projectId = 'approval-runtime-e2e';
    const database = new Database(path.join(workspace, 'workspace', 'workspace.sqlite'), { fileMustExist: true });
    try {
      database.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(projectId, 'Approval Runtime E2E', Date.now(), Date.now());
    } finally { database.close(); }

    // 第一段：按默认方式启动。没有终端、也没有放行，外部调用方只能查看和拒绝。
    {
      // 调用方自报的名称只用于显示：冒充成用户本人，也还是只能查看和拒绝。
      const receipt = readReceipt(await runCli(['send', 'approval-fixture', '--project', projectId,
        '--agent', 'default', '--model', 'approval-fixture', '--executor', 'Linnya 用户'], environment));
      const watchArgs = ['status', receipt.conversation_id, '--run', receipt.run_id,
        '--watch', '--interval', '250', '--timeout', '20000'];
      const blocked = await runCli(watchArgs, environment);
      expect(readLastJsonLine(blocked.stdout), guarded.stderr).toMatchObject({ snapshot: {
        run_id: receipt.run_id, status: 'running', command_approvals: [{ status: 'awaiting_reply' }],
      } });
      // watch 照常给出状态，但以“这一步只有用户能做”结束：外部 Agent 该转告用户并停下，不是接着查。
      expect(blocked.code, blocked.stderr).toBe(9);
      expect(parseJson(blocked.stderr)).toMatchObject({
        command: 'status',
        error: { code: 'approval_requires_user', retryable: false, message: expect.stringContaining('--allow-external-approval') },
      });
      const listArgs = ['approvals', receipt.conversation_id, '--run', receipt.run_id];
      const listed = ConversationControlCommandApprovalsResponseSchema.parse(parseJson((await runCli(listArgs, environment)).stdout));
      if (listed.action !== 'list') throw new Error('Expected approval list');
      // 待审批照实列出，同时说明这位调用方不能代批、该请谁怎么做。
      expect(listed.pending).toMatchObject([{ command: fixture.command, available_choices: ['allow_once', 'deny'] }]);
      expect(listed.external_approval).toMatchObject({
        permitted: false, message: expect.stringContaining('--allow-external-approval'),
      });
      const pending = listed.pending[0];
      if (!pending) throw new Error('Missing pending approval');
      const replyBase = ['approval-reply', receipt.conversation_id, '--run', pending.agent_run_id,
        '--request', pending.approval_request_id];
      const refused = await runCli([...replyBase, '--choice', 'allow_once'], environment);
      expect(refused.code, refused.stdout).toBe(9);
      expect(refused.stdout).toBe('');
      expect(parseObject(refused.stderr)).toMatchObject({
        ok: false,
        error: { code: 'approval_requires_user', retryable: false, message: expect.stringContaining('Only the person at the runtime terminal') },
      });
      // 被拒的“允许”不结算请求：命令没有执行，审批仍在等人。
      expect(fixture.toolResults).toHaveLength(0);
      const stillPending = ConversationControlCommandApprovalsResponseSchema.parse(parseJson((await runCli(listArgs, environment)).stdout));
      expect(stillPending).toMatchObject({ pending: [{ approval_request_id: pending.approval_request_id, status: 'awaiting_reply' }] });
      // 理由只能跟着拒绝走。
      expect((await runCli([...replyBase, '--choice', 'allow_once', '--reason', 'x'], environment)).code).toBe(2);
      const denied = await runCli([...replyBase, '--choice', 'deny', '--reason', 'keep that folder; write to scratch/ instead'], environment);
      expect(denied.code, denied.stderr).toBe(0);
      expect(parseObject(denied.stdout)).toMatchObject({ status: 'accepted' });
      expect(readLastJsonLine((await runCli(watchArgs, environment)).stdout), guarded.stderr).toMatchObject({ snapshot: {
        run_id: receipt.run_id, status: 'completed', command_approvals: [],
      } });
      // 模型夹具收到的工具结果里带着拒绝理由，命令没有执行。
      expect(fixture.toolResults).toHaveLength(1);
      expect(fixture.toolResults[0]).toContain('keep that folder; write to scratch/ instead');
      expect(fixture.toolResults[0]).not.toContain('approval-e2e-executed');
    }
    guarded.child.kill('SIGTERM');
    expect(await waitForClose(guarded.child), guarded.stderr).toBe(0);
    removeLiveRuntime(guarded.child);

    // 第二段：同一份数据，启动时显式放行。行为与放开前一致：外部调用方的接受、拒绝和取消都结算原 run。
    const runtime = await startRuntime({ workspace, environment, allowExternalApproval: true });
    for (const choice of ['allow_once', 'deny', 'cancel'] as const) {
      const receipt = readReceipt(await runCli(['send', 'approval-fixture', '--project', projectId,
        '--agent', 'default', '--model', 'approval-fixture'], environment));
      const watchArgs = ['status', receipt.conversation_id, '--run', receipt.run_id,
        '--watch', '--interval', '250', '--timeout', '20000'];
      const waiting = await runCli(watchArgs, environment);
      expect(waiting.code, waiting.stderr).toBe(0);
      expect(readLastJsonLine(waiting.stdout), `${choice}: ${waiting.stdout}\nfixture results: ${JSON.stringify(fixture.toolResults)}\n${runtime.stderr}`).toMatchObject({ snapshot: {
        run_id: receipt.run_id, status: 'running',
        command_approvals: [{ status: 'awaiting_reply' }],
      } });
      const list = await runCli(['approvals', receipt.conversation_id, '--run', receipt.run_id], environment);
      const response = ConversationControlCommandApprovalsResponseSchema.parse(parseJson(list.stdout));
      if (response.action !== 'list') throw new Error('Expected approval list');
      expect(response.external_approval).toEqual({ permitted: true });
      expect(response.pending).toHaveLength(1);
      const pending = response.pending[0];
      if (!pending) throw new Error('Missing pending approval');
      expect(pending.agent_run_id).toBe(receipt.run_id);
      expect(pending.command).toBe(fixture.command);
      const previousResults = fixture.toolResults.length;
      const replyArgs = ['approval-reply', receipt.conversation_id, '--run', pending.agent_run_id,
        '--request', pending.approval_request_id, '--choice', choice === 'cancel' ? 'allow_once' : choice];
      if (choice === 'cancel') {
        const stopped = await runCli(['stop', receipt.conversation_id, '--run', receipt.run_id], environment);
        expect(stopped.code, stopped.stderr).toBe(0);
      } else {
        // 两个真实 CLI 进程竞态回复，同一个 proposal 只能接纳一次。
        const replies = await Promise.all([runCli(replyArgs, environment), runCli(replyArgs, environment)]);
        expect(replies.map(reply => reply.code).sort()).toEqual([0, 6]);
        expect(replies.map(reply => Reflect.get(parseObject(reply.stdout), 'status')).sort())
          .toEqual(['accepted', 'stale']);
      }
      const done = await runCli(watchArgs, environment);
      expect(done.code, done.stderr).toBe(0);
      expect(readLastJsonLine(done.stdout), `${choice}: ${done.stdout}\n${runtime.stderr}`).toMatchObject({ snapshot: {
        run_id: receipt.run_id, status: choice === 'cancel' ? 'cancelled' : 'completed', command_approvals: [],
      } });
      if (choice === 'cancel') {
        expect((await runCli(replyArgs, environment)).code).toBe(6);
        expect(fixture.toolResults).toHaveLength(previousResults);
      } else {
        expect(fixture.toolResults).toHaveLength(previousResults + 1);
        const result = fixture.toolResults.at(-1);
        if (choice === 'allow_once') expect(result).toContain('approval-e2e-executed');
        else {
          expect(result).not.toContain('approval-e2e-executed');
          expect(result).toMatch(/denied|rejected|拒绝/);
        }
      }
    }

    // 同一真实 Runtime 里，Agent 删除本会话目录里自己的普通文件不进入审批，直接完成。
    fixture.command = 'printf scratch > local-scratch.csv; rm -f local-scratch.csv; printf local-removed-without-approval';
    const localReceipt = readReceipt(await runCli(['send', 'local-removal', '--project', projectId,
      '--agent', 'default', '--model', 'approval-fixture'], environment));
    const localResults = fixture.toolResults.length;
    const localDone = await runCli(['status', localReceipt.conversation_id, '--run', localReceipt.run_id,
      '--watch', '--interval', '250', '--timeout', '20000'], environment);
    expect(localDone.code, localDone.stderr).toBe(0);
    expect(readLastJsonLine(localDone.stdout), `${localDone.stdout}\n${runtime.stderr}`).toMatchObject({ snapshot: {
      run_id: localReceipt.run_id, status: 'completed', command_approvals: [],
    } });
    expect(fixture.toolResults).toHaveLength(localResults + 1);
    expect(fixture.toolResults.at(-1)).toContain('local-removed-without-approval');

    runtime.child.kill('SIGTERM');
    expect(await waitForClose(runtime.child), runtime.stderr).toBe(0);
    removeLiveRuntime(runtime.child);
  }, 150_000);

  it('冷启动、并行运行、拒绝第二 owner，并在重启后保留历史', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-runtime-e2e-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'runtime-host/_dev_electron/runtime/conversation-control-v1.json');
    const modelCatalog = path.join(root, 'default-models.json');
    await fs.mkdir(workspace, { recursive: true });
    await writeFastMockModelCatalog(modelCatalog);
    const startupEnvironment = await createRuntimeEnvironment({ connectionFile: path.join(root, 'connection.json'), modelCatalog });
    delete startupEnvironment.LINNYA_CLI_CONNECTION_FILE;
    const environment = { ...startupEnvironment, LINNYA_CLI_CONNECTION_FILE: connectionFile };
    await fs.writeFile(path.join(root, 'runtime-host/.env.local'), 'LINNYA_AUDIT_LEVEL=behavior\n');

    const first = await startRuntime({ workspace, environment: startupEnvironment });
    expect(await fs.stat(connectionFile)).toMatchObject({ mode: expect.any(Number) });
    expect(first.ready.runtime.database_ready).toBe(true);
    expect(first.stderr).not.toContain('Electron');

    const doctor = await runCli(['doctor'], environment);
    expect(doctor.code).toBe(0);
    expect(parseJson(doctor.stdout)).toMatchObject({
      ok: true,
      app: { version: '0.0.38', source_root: repoRoot, audit_level: 'behavior' },
    });

    expect(parseJson((await runCli(['audit', 'level'], environment)).stdout)).toMatchObject({ level: 'behavior' });
    const change = await runCli(['audit', 'level', 'stream'], environment);
    expect(change.code, change.stderr).toBe(0);
    expect(parseJson(change.stdout)).toMatchObject({ level: 'stream' });
    expect(parseJson((await runCli(['doctor'], environment)).stdout)).toMatchObject({ app: { audit_level: 'stream' } });

    // 两个独立 Host 同时运行；改变第一个的默认档位不能影响第二个。
    const otherRoot = path.join(root, 'other');
    const otherEnvironment = await createRuntimeEnvironment({ connectionFile: path.join(otherRoot, 'connection.json'), modelCatalog });
    const other = await startRuntime({ workspace: path.join(otherRoot, 'workspace'), environment: otherEnvironment });
    expect(parseJson((await runCli(['audit', 'level'], otherEnvironment)).stdout)).toMatchObject({ level: 'off' });
    expect(parseJson((await runCli(['audit', 'level'], environment)).stdout)).toMatchObject({ level: 'stream' });
    other.child.kill('SIGTERM');
    expect(await waitForClose(other.child), other.stderr).toBe(0);
    removeLiveRuntime(other.child);

    // 空数据工作区通过正式 CLI 创建项目，然后用返回身份发起会话。
    const empty = await runCli(['projects', 'list'], environment);
    expect(parseJson(empty.stdout)).toMatchObject({ action: 'list', projects: [] });
    const temporary = await runCli(['projects', 'create', 'Temporary'], environment);
    const temporaryProject = ConversationControlProjectsResponseSchema.parse(parseJson(temporary.stdout));
    if (temporaryProject.action !== 'create') throw new Error('Expected project creation');
    const temporaryId = temporaryProject.project.project_id;
    const deleted = await runCli(['projects', 'delete', temporaryId, '--yes'], environment);
    expect(deleted.code, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout)).toMatchObject({ action: 'delete', project_id: temporaryId });
    const created = await runCli(['projects', 'create', 'CLI Runtime E2E', '--description', 'Runtime check'], environment);
    expect(created.code, created.stderr).toBe(0);
    const creation = ConversationControlProjectsResponseSchema.parse(parseJson(created.stdout));
    if (creation.action !== 'create') throw new Error('Expected project creation');
    const projectId = creation.project.project_id;
    const updated = await runCli(['projects', 'update', projectId, '--description='], environment);
    expect(updated.code, updated.stderr).toBe(0);
    expect(parseJson(updated.stdout)).toMatchObject({ action: 'update', project: { project_id: projectId, description: '' } });
    const projects = await runCli(['projects'], environment);
    expect(projects.code).toBe(0);
    const listing = ConversationControlProjectsResponseSchema.parse(parseJson(projects.stdout));
    if (listing.action !== 'list') throw new Error('Expected project list');
    expect(listing.projects).toContainEqual({ project_id: projectId, name: 'CLI Runtime E2E' });

    const [sendA, sendB] = await Promise.all([
      runCli(['send', 'parallel-a', '--project', projectId, '--agent', 'default', '--model', 'mock-debug-chat'], environment),
      runCli(['send', 'parallel-b', '--project', projectId, '--agent', 'writing', '--model', 'mock-debug-chat'], environment),
    ]);
    const receiptA = readReceipt(sendA);
    const receiptB = readReceipt(sendB);
    expect(receiptA.conversation_id).not.toBe(receiptB.conversation_id);
    const blockedDelete = await runCli(['projects', 'delete', projectId, '--yes'], environment);
    expect(blockedDelete.code, blockedDelete.stderr).toBe(6);
    expect(parseJson(blockedDelete.stderr)).toMatchObject({ error: {
      code: 'project_not_empty',
      message: expect.stringContaining('Ask the user to delete this project manually in the Linnya desktop app.'),
    } });

    const [statusA, statusB] = await Promise.all([
      runCli([
        'status', receiptA.conversation_id, '--run', receiptA.run_id,
        '--watch', '--interval', '250', '--timeout', '20000',
      ], environment),
      runCli([
        'status', receiptB.conversation_id, '--run', receiptB.run_id,
        '--watch', '--interval', '250', '--timeout', '20000',
      ], environment),
    ]);
    expect(statusA.code).toBe(0);
    expect(statusB.code).toBe(0);
    expect(readLastJsonLine(statusA.stdout)).toMatchObject({ snapshot: { status: 'completed' } });
    expect(readLastJsonLine(statusB.stdout)).toMatchObject({ snapshot: { status: 'completed' } });

    const disabled = await runCli(['audit', 'level', 'off'], environment);
    expect(disabled.code, disabled.stderr).toBe(0);
    const audit = await runCli(['audit', receiptA.conversation_id, '--run', receiptA.run_id], environment);
    expect(audit.code, audit.stderr).toBe(0);
    expect(parseJson(audit.stdout)).toMatchObject({ command: 'audit', requested_run_id: receiptA.run_id });

    const contender = await runCli([
      'runtime', 'start', '--workspace', workspace,
      '--qdrant-port', String(await reservePort()),
    ], { ...environment, LINNYA_CLI_CONNECTION_FILE: path.join(root, 'contender.json') });
    expect(contender.code).toBe(6);
    expect(readJsonLines(contender.stderr).find(hasErrorField)).toMatchObject({
      error: { code: 'conversation_busy' },
    });

    first.child.kill('SIGINT');
    expect(await waitForClose(first.child), first.stderr).toBe(0);
    removeLiveRuntime(first.child);
    await expect(fs.stat(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(isProcessAlive(first.ready.runtime.pid)).toBe(false);

    const restarted = await startRuntime({ workspace, environment: startupEnvironment });
    expect(parseJson((await runCli(['audit', 'level'], environment)).stdout)).toMatchObject({ level: 'behavior' });
    const auditAfterRestart = await runCli(['audit', receiptA.conversation_id, '--run', receiptA.run_id], environment);
    expect(auditAfterRestart.code, auditAfterRestart.stderr).toBe(0);
    const removedProject = await runCli(['projects', 'get', temporaryId], environment);
    expect(removedProject.code).toBe(6);
    expect(parseJson(removedProject.stderr)).toMatchObject({ error: { code: 'project_not_found' } });
    const savedProject = await runCli(['projects', 'get', projectId], environment);
    expect(savedProject.code, savedProject.stderr).toBe(0);
    expect(parseJson(savedProject.stdout)).toMatchObject({ project: {
      project_id: projectId, name: 'CLI Runtime E2E', description: '',
    } });
    const history = await runCli(['list', '--project', projectId, '--limit', '10'], environment);
    expect(history.code).toBe(0);
    const conversationIds = readConversationIds(history.stdout);
    expect(conversationIds).toEqual(expect.arrayContaining([
      receiptA.conversation_id,
      receiptB.conversation_id,
    ]));
    restarted.child.kill('SIGTERM');
    expect(await waitForClose(restarted.child), restarted.stderr).toBe(0);
    removeLiveRuntime(restarted.child);
    await expect(fs.stat(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 90_000);

  it('没有配置任何聊天模型时，外部命令照常写入并读回文档；发消息给 Linnya 的 Agent 得到明确说明', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-runtime-e2e-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'connection.json');
    // 新安装不预置任何模型；只用自己的外部 Agent 的用户也不会去配置。
    const modelCatalog = path.join(root, 'default-models.json');
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(modelCatalog, JSON.stringify({ models: [] }));
    const environment = await createRuntimeEnvironment({ connectionFile, modelCatalog });
    const runtime = await startRuntime({ workspace, environment });

    expect(parseJson((await runCli(['models'], environment)).stdout)).toMatchObject({ chat: [] });
    const created = await runCli(['projects', 'create', 'No Model'], environment);
    expect(created.code, created.stderr).toBe(0);
    const creation = ConversationControlProjectsResponseSchema.parse(parseJson(created.stdout));
    if (creation.action !== 'create') throw new Error('Expected project creation');
    const projectId = creation.project.project_id;

    const written = await runCli(['tools', 'call', 'write_file', '--project', projectId, '--args-json',
      JSON.stringify({ locator: 'workspace:/notes/plan.md', content: '# Plan\n\nWritten without a Linnya model.\n' }),
      '--timeout', '30000'], environment);
    expect(written.code, written.stderr).toBe(0);
    const read = await runCli(['tools', 'call', 'read_file', '--project', projectId, '--args-json',
      JSON.stringify({ locator: 'workspace:/notes/plan.md' }), '--timeout', '30000'], environment);
    expect(read.code, read.stderr).toBe(0);
    expect(read.stdout).toContain('Written without a Linnya model.');

    // 两个外部 Agent 先后改同一份文档：一个由运行环境识别，一个显式报名；第三次不报。
    const write = (content: string, extra: readonly string[], agentEnvironment: NodeJS.ProcessEnv = {}) => runCli(
      ['tools', 'call', 'write_file', '--project', projectId, '--new-session', '--args-json',
        JSON.stringify({ locator: 'workspace:/notes/plan.md', content }), '--timeout', '30000', ...extra],
      { ...environment, ...agentEnvironment },
    );
    for (const result of [
      await write('# Plan\n\nRevised by the first agent.\n', [], { CLAUDECODE: '1' }),
      await write('# Plan\n\nRevised by the second agent.\n', ['--executor', 'Codex']),
      await write('# Plan\n\nRevised by an unnamed caller.\n', []),
    ]) expect(result.code, result.stderr).toBe(0);
    const database = new Database(path.join(workspace, 'workspace', 'workspace.sqlite'), { fileMustExist: true, readonly: true });
    try {
      // 改动记录分得清每一次是谁改的；没报名称的仍只知道来自命令行。
      expect(database.prepare(`SELECT actor_kind, external_executor FROM action_ledger_entries
        WHERE project_id = ? ORDER BY id`).all(projectId)).toEqual([
        { actor_kind: 'external', external_executor: null },
        { actor_kind: 'external', external_executor: 'Claude Code' },
        { actor_kind: 'external', external_executor: 'Codex' },
        { actor_kind: 'external', external_executor: null },
      ]);
    } finally { database.close(); }

    const sent = await runCli(['send', 'hello', '--project', projectId], environment);
    expect(sent.code).toBe(7);
    expect(parseJson(sent.stderr)).toMatchObject({
      error: { code: 'capability_unavailable', message: expect.stringContaining('linnya tools call') },
    });

    runtime.child.kill('SIGTERM');
    expect(await waitForClose(runtime.child), runtime.stderr).toBe(0);
    removeLiveRuntime(runtime.child);
  }, 90_000);

  it('模型续轮仍在等待时退出，重启可继续同一 run，已结算的 Shell 只执行一次', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-active-exit-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'connection.json');
    const modelCatalog = path.join(root, 'models.json');
    const fixture = await startApprovalModelFixture({ holdFirstToolReply: true });
    modelServers.push(fixture.server);
    // 副作用只在本对话的临时工作目录内。重复执行同一条命令会留下第二行。
    fixture.command = 'echo done >> settled.txt';
    await writeApprovalModelCatalog(modelCatalog, fixture.url);
    const environment = await createRuntimeEnvironment({ connectionFile, modelCatalog });
    const runtime = await startRuntime({ workspace, environment });
    const project = ConversationControlProjectsResponseSchema.parse(parseJson(
      (await runCli(['projects', 'create', 'Shutdown fixture'], environment)).stdout,
    ));
    if (project.action !== 'create') throw new Error('Expected project creation');
    const receipt = readReceipt(await runCli(['send', 'Run the fixture command', '--project', project.project.project_id,
      '--agent', 'default', '--model', 'approval-fixture'], environment));
    await waitFor(() => fixture.toolResults.length === 1, 15_000);
    runtime.child.kill('SIGTERM');
    expect(await waitForClose(runtime.child), runtime.stderr).toBe(0);
    removeLiveRuntime(runtime.child);
    await waitFor(fixture.heldResponseClosed, 5_000);
    expect(isWorkspaceOwnershipAvailable(workspace)).toBe(true);

    const reopened = await startRuntime({ workspace, environment });
    const runArgs = [receipt.conversation_id, '--run', receipt.run_id];
    const status = await runCli(['status', ...runArgs], environment);
    expect(parseJson(status.stdout)).toMatchObject({ run: { run_id: receipt.run_id, status: 'paused' } });
    const resumed = await runCli(['resume', ...runArgs], environment);
    expect(resumed.code, resumed.stderr).toBe(0);
    const done = await runCli(['status', ...runArgs, '--watch', '--interval', '250', '--timeout', '20000'], environment);
    expect(readLastJsonLine(done.stdout)).toMatchObject({ snapshot: { run_id: receipt.run_id, status: 'completed' } });
    const read = await runCli(['tools', 'call', 'read_file', '--conversation', receipt.conversation_id,
      '--args-json', JSON.stringify({ locator: 'conversation:/settled.txt' })], environment);
    expect(read.code, read.stderr).toBe(0);
    expect(parseJson(read.stdout)).toMatchObject({ tool: {
      content: expect.stringContaining('1 | done'),
      payload: { data: { locator: 'conversation:/settled.txt', byte_length: Buffer.byteLength('done\n') } },
    } });
    reopened.child.kill('SIGTERM');
    expect(await waitForClose(reopened.child), reopened.stderr).toBe(0);
    removeLiveRuntime(reopened.child);
  }, 60_000);

  it('launcher 被 SIGKILL 后 App Server 通过 pipe EOF 收口，并允许同一 Workspace 重启', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-runtime-crash-e2e-'));
    temporaryRoots.push(root);
    const workspace = path.join(root, 'workspace');
    const connectionFile = path.join(root, 'connection.json');
    const modelCatalog = path.join(root, 'default-models.json');
    await fs.mkdir(workspace, { recursive: true });
    await writeFastMockModelCatalog(modelCatalog);
    const environment = await createRuntimeEnvironment({ connectionFile, modelCatalog });

    const crashed = await startRuntime({ workspace, environment });
    const previousDescriptor = await readConnectionIdentity(connectionFile);
    crashed.child.kill('SIGKILL');
    await waitForClose(crashed.child);
    removeLiveRuntime(crashed.child);
    // orphan 在部分平台会短暂保留 zombie PID，descriptor 也可能在异常退出竞态中残留。
    // 真正的恢复门禁是旧 API 已停且 Workspace 排他 owner 已释放。
    await waitFor(() => isWorkspaceOwnershipAvailable(workspace), 30_000);

    const restarted = await startRuntime({ workspace, environment: {
      ...environment,
      LINNYA_CLI_RUNTIME_MODULE: path.join(import.meta.dirname, 'fixtures/delayedRuntimeDiagnostics.cjs'),
    } });
    const replacementDescriptor = await readConnectionIdentity(connectionFile);
    expect(replacementDescriptor.pid).toBe(restarted.ready.runtime.pid);
    expect(replacementDescriptor.appInstanceId).not.toBe(previousDescriptor.appInstanceId);
    restarted.child.kill('SIGTERM');
    expect(await waitForClose(restarted.child), restarted.stderr).toBe(0);
    expect(restarted.stderr).toContain('fixture-delayed-shutdown-diagnostic');
    removeLiveRuntime(restarted.child);
  }, 45_000);
});

function parseObject(text: string): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(parseJson(text));
}

async function startRuntime(input: {
  readonly workspace: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly allowExternalApproval?: boolean;
}): Promise<{
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: { readonly runtime: { readonly pid: number; readonly database_ready: boolean } };
  readonly stderr: string;
}> {
  const child = spawn(process.execPath, [
    cliEntry,
    'runtime', 'start',
    '--workspace', input.workspace,
    ...(input.allowExternalApproval ? ['--allow-external-approval'] : []),
  ], {
    cwd: repoRoot,
    env: input.environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  liveRuntimes.push(child);
  child.stdin.end();
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr = `${stderr}${String(chunk)}`.slice(-200_000);
  });
  const ready = await readFirstJsonLine(child, 20_000).catch((error: unknown) => {
    // 此夹具只使用合成配置；保留启动诊断，区分接纳逻辑失败与本机缺少运行时资产。
    throw new Error(`CLI Runtime ready 失败\n${stderr}`, { cause: error });
  });
  if (!isRuntimeReady(ready)) {
    throw new Error(`CLI Runtime 返回无效 ready frame: ${JSON.stringify(ready)}\n${stderr}`);
  }
  return { child, ready, get stderr() { return stderr; } };
}

function runCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: repoRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += String(chunk); });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

function readFirstJsonLine(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('等待 CLI Runtime ready 超时'));
    }, timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      buffer += String(chunk);
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      cleanup();
      try {
        resolve(JSON.parse(buffer.slice(0, lineEnd)));
      } catch (error: unknown) {
        reject(error);
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('CLI Runtime 在 ready 前退出'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('close', onClose);
    };
    child.stdout.on('data', onData);
    child.once('close', onClose);
  });
}

function waitForClose(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('等待 CLI Runtime 退出超时')), 15_000);
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试端口不可用');
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

async function writeFastMockModelCatalog(target: string): Promise<void> {
  const source = await fs.readFile(path.join(
    repoRoot,
    'src/domains/model-catalog/features/default-catalog/assets/default_models.json',
  ), 'utf8');
  const original = 'mock://local?script=markdown_kitchen_sink';
  const replacement = 'mock://local?preset=content&delay_ms=0&chunk_size=200';
  if (!source.includes(original)) throw new Error('默认 mock 模型测试入口不存在');
  await fs.writeFile(target, source.replace(original, replacement));
}

async function createRuntimeEnvironment(input: {
  readonly connectionFile: string;
  readonly modelCatalog: string;
}): Promise<NodeJS.ProcessEnv> {
  const developmentRoot = path.join(path.dirname(input.connectionFile), 'runtime-host');
  await fs.mkdir(developmentRoot, { recursive: true });
  // Workspace 与 AppData 分属不同路径。仅覆盖 Workspace 会读到开发者的权限设置和凭据。
  // 只复用本次构建的只读资产，所有可写运行状态保留在临时 development root。
  // parser-wasm 的 Node 产物由 build:wasm 生成，后端规范化 Markdown 写入时按 development root 查找。
  for (const directory of ['dist', 'extraResources', 'src/features/skills/builtin/skills', 'packages/parser-wasm/pkg-node']) {
    await fs.mkdir(path.dirname(path.join(developmentRoot, directory)), { recursive: true });
    await fs.symlink(path.join(repoRoot, directory), path.join(developmentRoot, directory), 'junction');
  }
  return {
    ...process.env,
    // 测试常由 Claude Code、Codex 启动；去掉它们的环境标记，命令行才不会自动带上执行者名称。
    ...Object.fromEntries(AGENT_ENVIRONMENT_VARIABLES.map(name => [name, undefined])),
    LINNYA_CLI_CONNECTION_FILE: input.connectionFile,
    LINNYA_AUDIT_LEVEL: undefined,
    NODE_ENV: 'development',
    LINNYA_CLI_RUNTIME_MODULE: path.join(repoRoot, 'dist/main/linnya-cli-runtime.cjs'),
    LINNYA_CLI_DEVELOPMENT_ROOT: developmentRoot,
    LINNYA_PLUGIN_ROOT: path.join(developmentRoot, '_dev_data/plugins'),
    MODEL_REGISTRY_DEFAULTS_PATH: input.modelCatalog,
    LINNYA_PLUGIN_DIRECT_DIRS: undefined,
    LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: undefined,
  };
}

function isRuntimeReady(value: unknown): value is {
  readonly runtime: { readonly pid: number; readonly database_ready: boolean };
} {
  if (typeof value !== 'object' || value === null) return false;
  const runtime = Reflect.get(value, 'runtime');
  return typeof runtime === 'object'
    && runtime !== null
    && typeof Reflect.get(runtime, 'pid') === 'number'
    && Reflect.get(runtime, 'database_ready') === true;
}

function parseJson(text: string): unknown {
  return JSON.parse(text.trim());
}

function readReceipt(result: { readonly code: number | null; readonly stdout: string; readonly stderr: string }): {
  readonly conversation_id: string;
  readonly run_id: string;
} {
  if (result.code !== 0) throw new Error(`send 失败: ${result.stderr}`);
  const value = parseJson(result.stdout);
  if (typeof value !== 'object' || value === null) throw new Error('send 回执不是对象');
  const receipt = Reflect.get(value, 'receipt');
  if (typeof receipt !== 'object' || receipt === null) throw new Error('send 回执缺少 receipt');
  const conversationId = Reflect.get(receipt, 'conversation_id');
  const runId = Reflect.get(receipt, 'run_id');
  if (typeof conversationId !== 'string' || typeof runId !== 'string') {
    throw new Error('send 回执缺少 Conversation/Run identity');
  }
  return { conversation_id: conversationId, run_id: runId };
}

function readLastJsonLine(text: string): unknown {
  const lines = text.trim().split('\n');
  return JSON.parse(lines.at(-1) ?? 'null');
}

function readJsonLines(text: string): readonly unknown[] {
  return text.split('\n').flatMap(line => {
    try {
      const value: unknown = JSON.parse(line);
      return [value];
    } catch {
      return [];
    }
  });
}

function hasErrorField(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Reflect.has(value, 'error');
}

function readConversationIds(text: string): readonly string[] {
  const value = parseJson(text);
  if (typeof value !== 'object' || value === null) throw new Error('history 不是对象');
  const conversations = Reflect.get(value, 'conversations');
  if (!Array.isArray(conversations)) throw new Error('history 缺少 conversations');
  return conversations.flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const id = Reflect.get(item, 'conversation_id');
    return typeof id === 'string' ? [id] : [];
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeLiveRuntime(child: ChildProcessWithoutNullStreams): void {
  const index = liveRuntimes.indexOf(child);
  if (index >= 0) liveRuntimes.splice(index, 1);
}

async function readConnectionIdentity(target: string): Promise<{
  readonly pid: number;
  readonly appInstanceId: string;
}> {
  const value: unknown = JSON.parse(await fs.readFile(target, 'utf8'));
  if (typeof value !== 'object' || value === null) throw new Error('连接描述不是对象');
  const pid = Reflect.get(value, 'pid');
  const appInstanceId = Reflect.get(value, 'app_instance_id');
  if (typeof pid !== 'number' || typeof appInstanceId !== 'string') {
    throw new Error('连接描述缺少 Runtime identity');
  }
  return { pid, appInstanceId };
}

function isWorkspaceOwnershipAvailable(workspace: string): boolean {
  const connection = new Database(path.join(workspace, '.runtime-owner.lock'), { timeout: 0 });
  try {
    connection.exec('BEGIN EXCLUSIVE');
    connection.exec('ROLLBACK');
    return true;
  } catch {
    return false;
  } finally {
    connection.close();
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error(`等待 Runtime 收口超时: ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
