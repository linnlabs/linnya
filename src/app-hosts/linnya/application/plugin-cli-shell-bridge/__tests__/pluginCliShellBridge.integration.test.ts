import { createConversationActivityPorts } from '../../../adapters/persistence/run-registry';
import { createCoreCli } from '../../core-cli';
import { createNodePhysicalFileReader } from '../../../adapters/file-read';
import { ColorPaletteSuggestionSchema } from '@app/schemas/color-palette';
import sharp from 'sharp';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
import { createProjectLifecycle } from 'src/domains/projects';
import { DatabaseService } from 'src/electron-main/services/database';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CommandLaunchSnapshotV1Schema,
  parseCommandExecutionTerminal,
  type CommandExecutionTerminalV1,
} from '@app/schemas/commands';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import { createPluginCliInferenceSession } from '../../../adapters/inference';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
  type PreparedCommandExecutionRuntime,
} from '../../../../../domains/commands';
import {
  activateDesiredBackendPluginClis,
  clearBackendPluginClisForTests,
} from '../../../plugin-registry/pluginCliInvocationRuntime';
import type { BackendPluginCliRegistration } from '../../../plugin-registry/registry';
import {
  LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV,
  LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV,
  PLUGIN_CLI_MAX_OUTPUT_BYTES,
  PLUGIN_CLI_OUTPUT_FRAME_BYTES,
  parsePluginCliBridgeFrame,
  startPluginCliShellBridgeRuntime,
  type PluginCliBridgeDiagnosticPort,
  type PluginCliBridgeFrameV1,
  type PluginCliShellBridgeRuntime,
} from '..';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const bridges: PluginCliShellBridgeRuntime[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.closeAndWait()));
  await Promise.all(temporaryRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
  await clearBackendPluginClisForTests();
});

function runNativeFacade(input: {
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly internalEnvironment: Readonly<Record<string, string>>;
}): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executablePath, input.argv, {
      shell: false,
      env: { ...process.env, ...input.internalEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', exitCode => resolve({
      exitCode,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function createLaunch(input: {
  readonly permissionLevel?: 'read_only' | 'standard';
  readonly internalDataAccess?: 'allowed' | 'denied';
  readonly conversationRoot?: string;
} = {}) {
  const permissionLevel = input.permissionLevel ?? 'standard';
  const internalDataAccess = input.internalDataAccess ?? 'allowed';
  const identity = {
    conversation_id: 'conversation-plugin-cli-bridge',
    agent_run_id: 'agent-run-plugin-cli-bridge',
    origin_tool_call_id: 'tool-call-plugin-cli-bridge',
    command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000001',
    owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000002',
    created_at_ms: 100,
  };
  const permission = {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: permissionLevel,
    effective_level: permissionLevel,
    grant_source: 'global_setting',
    internal_data_access: internalDataAccess,
  };
  return CommandLaunchSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'pipe_command_launch_snapshot',
    mode: 'pipe',
    stdin: 'closed',
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: 'linnya-slides inspect --presentation deck-1',
      cwd: '/tmp/conversation-plugin-cli-bridge',
      permission,
    },
    conversation_root: input.conversationRoot ?? '/tmp/conversation-plugin-cli-bridge',
    permission,
    shell: {
      platform: 'macos',
      shell_semantics_id: 'zsh',
      shell_version: '5.9',
      snapshot_revision: 'plugin-cli-bridge-test',
      output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'plain-v1',
      executable_path: '/bin/zsh',
      argv_prefix: ['-f', '-c'],
    },
    environment: {
      revision: 'plugin-cli-bridge-test',
      entries: { PATH: '/usr/bin:/bin' },
    },
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: 30_000,
  });
}

function createTerminal(launch: ReturnType<typeof createLaunch>): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: launch.proposal.identity,
    settled_at_ms: 200,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: { status: 'observed', exit_code: 0, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  });
}

function createPreparedRuntime(launch: ReturnType<typeof createLaunch>): {
  readonly runtime: PreparedCommandExecutionRuntime;
  readonly terminal: Deferred<CommandExecutionTerminalV1>;
} {
  const terminal = deferred<CommandExecutionTerminalV1>();
  return {
    terminal,
    runtime: {
      interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
      terminal: terminal.promise,
      outputObservation: {
        read: () => ({ status: 'invalid_cursor' }),
        waitForChange: async () => ({ status: 'invalid_cursor' }),
      },
      settledTextOutput: Promise.resolve(createUnavailableCommandSettledTextOutput('pipe')),
      start: async () => ({ status: 'running', startedAtMs: 150 }),
      stopAndWait: async () => {
        const value = createTerminal(launch);
        terminal.resolve(value);
        return value;
      },
    },
  };
}

function registerCli(cli: BackendPluginCliContribution): BackendPluginCliRegistration {
  const registration = { pluginId: 'slides', cli };
  activateDesiredBackendPluginClis([registration]);
  return registration;
}

async function startBridge(input: {
  readonly createInferenceSession?: Parameters<typeof startPluginCliShellBridgeRuntime>[0]['createInferenceSession'];
  readonly createConversationInput?: Parameters<typeof startPluginCliShellBridgeRuntime>[0]['createConversationInput'];
  readonly registration: BackendPluginCliRegistration;
  readonly internalDataContext?: unknown;
  readonly readConversationProjectId?: (conversationId: string) => Promise<string | null | undefined>;
  readonly diagnostics?: PluginCliBridgeDiagnosticPort;
  readonly createCorrelationId?: () => string;
}): Promise<PluginCliShellBridgeRuntime> {
  const bridge = await startPluginCliShellBridgeRuntime({
    resolveCli: pluginId => (
      pluginId === input.registration.pluginId ? input.registration : undefined
    ),
    internalDataContext: input.internalDataContext ?? Object.freeze({}),
    ...(input.createInferenceSession ? { createInferenceSession: input.createInferenceSession } : {}),
    ...(input.createConversationInput ? { createConversationInput: input.createConversationInput } : {}),
    ...(input.readConversationProjectId ? { readConversationProjectId: input.readConversationProjectId } : {}),
    diagnostics: input.diagnostics ?? { recordUnexpectedFailure: () => undefined },
    createToken: () => 'a'.repeat(64),
    createInvocationId: () => 'invocation-1',
    ...(input.createCorrelationId ? { createCorrelationId: input.createCorrelationId } : {}),
  });
  bridges.push(bridge);
  return bridge;
}

async function invoke(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly argv: readonly string[];
  readonly core?: boolean;
}): Promise<{ readonly status: number; readonly frames: PluginCliBridgeFrameV1[] }> {
  const response = await fetch(input.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-linnya-plugin-cli-token': input.token,
    },
    body: JSON.stringify({
      protocol_version: 1,
      ...(input.core ? { kind: 'core_cli_invoke' } : { kind: 'plugin_cli_invoke', plugin_id: 'slides' }),
      argv: input.argv,
    }),
  });
  const body = await response.text();
  return {
    status: response.status,
    frames: body.trim()
      ? body.trim().split('\n').map(line => parsePluginCliBridgeFrame(JSON.parse(line)))
      : [],
  };
}

describe('Plugin CLI Shell bridge', () => {
  it.runIf(Boolean(process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH))('真实 Shell 内建 conversations：过滤、状态、项目作用域与只读全文', async () => {
    const client = process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH;
    if (!client) throw new Error('native client path is required');
    const database = new DatabaseService(':memory:');
    database.initialize();
    const db = database.getDb();
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-conversation-cli-'));
    temporaryRoots.push(root);
    const facade = path.join(root, process.platform === 'win32' ? 'linnya.exe' : 'linnya');
    await fsp.copyFile(client, facade);
    await fsp.chmod(facade, 0o700);
    const projects = createProjectLifecycle(db);
    const projectId = projects.create({ name: 'Shell conversations' });
    const otherProject = projects.create({ name: 'Other project' });
    for (const [id, project, title] of [['conversation-plugin-cli-bridge', projectId, '来源'], ['target', projectId, '定价'], ['private', otherProject, '私密']] as const) {
      db.prepare('INSERT INTO conversations (conversation_id, project_id, title, created_at, last_event_at) VALUES (?, ?, ?, 1, ?)').run(id, project, title, Date.now());
      db.prepare(`INSERT INTO runs (id, conversation_id, kind, status, agent_spec_id, start_ts, metadata_json) VALUES (?, ?, 'agent', 'cancelled', 'research_v1', 1, ?)`)
        .run(`run-${id}`, id, JSON.stringify({ lane: 'foreground' }));
      db.prepare(`INSERT INTO conversation_ui_messages (message_id, conversation_id, turn_id, role, message_type, sort_seq, timestamp, content, run_id)
        VALUES (?, ?, 'turn', 'assistant', 'partial_answer', 1, 1, ?, ?)`)
        .run(`message-${id}`, id, `${title}的回答`, `run-${id}`);
    }
    const bridge = await startPluginCliShellBridgeRuntime({
      resolveCli: () => { throw new Error('Core must not resolve plugin'); },
      coreCli: createCoreCli(db, 8000, createNodePhysicalFileReader(), createConversationActivityPorts(db, { readControlPending: () => [] })),
      readConversationProjectId: async id => db.prepare<[string], { project_id: string }>('SELECT project_id FROM conversations WHERE conversation_id = ?').get(id)?.project_id,
      internalDataContext: {}, diagnostics: { recordUnexpectedFailure: ({ error }) => { throw error; } },
    });
    bridges.push(bridge);
    try {
      const launch = createLaunch({ internalDataAccess: 'allowed', conversationRoot: root });
      const prepared = createPreparedRuntime(launch);
      const scope = bridge.prepareExecution(launch);
      const runtime = scope.decorate(prepared.runtime);
      await runtime.start();
      const invokeCli = (...argv: string[]) => runNativeFacade({
        executablePath: process.platform === 'darwin' ? '/bin/zsh' : facade,
        argv: process.platform === 'darwin' ? ['-c', 'exec "$@"', 'conversation-cli', facade, 'conversations', ...argv] : ['conversations', ...argv],
        internalEnvironment: scope.internalEnvironment,
      });
      const listed = await invokeCli('list', '--query', '定价', '--agent', 'research_v1', '--activity', 'today', '--documents', 'unchanged', '--sort', 'title');
      expect(listed.exitCode).toBe(0);
      expect(JSON.parse(listed.stdout)).toMatchObject({ conversations: [{ id: 'target', activity: { state: 'interrupted', reason: 'cancelled' } }] });
      const read = await invokeCli('read', 'target');
      expect(read.exitCode).toBe(0);
      expect(JSON.parse(read.stdout)).toMatchObject({ messages: [{ text: '定价的回答' }], conversation: { activity: { state: 'interrupted' } } });
      expect((await invokeCli('read', 'private')).stderr).toBe((await invokeCli('read', 'missing')).stderr);
      expect((await invokeCli('list', '--project', otherProject)).exitCode).toBe(2);
      expect((await invokeCli('list', '--conversation', 'private')).exitCode).toBe(2);
      expect((await invokeCli('list', '--sort', 'agent')).exitCode).toBe(2);
      prepared.terminal.resolve(createTerminal(launch));
      await runtime.terminal;
    } finally {
      await bridge.closeAndWait();
      database.close();
    }
  });

  it('内建 changes 只按父对话读取昨日记录，拒绝跨项目参数、拒绝未授权读取，并明说截断', async () => {
    const database = new DatabaseService(':memory:');
    database.initialize();
    try {
      const db = database.getDb();
      const projects = createProjectLifecycle(db);
      const projectId = projects.create({ name: '当前项目' });
      const other = projects.create({ name: '其他项目' });
      const workspace = new WorkspaceService(db);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const yesterday = new Date(start);
      yesterday.setDate(yesterday.getDate() - 1);
      for (const [project, name, date] of [
        [projectId, 'one.md', yesterday], [projectId, 'two.md', yesterday],
        [other, 'private.md', yesterday], [projectId, 'today.md', start],
      ] as const) {
        const id = workspace.createDocument(project, name, null, 'document');
        createSqliteActionLedger(db, { now: () => date.getTime() }).recorderFor({ kind: 'user' }, 'coarse')
          .record({ projectId: project, documentId: id, documentType: 'document', action: 'create' });
      }
      const readProject = vi.fn(async () => projectId);
      const bridge = await startPluginCliShellBridgeRuntime({
        resolveCli: () => { throw new Error('Core commands must not resolve a plugin'); },
        coreCli: createCoreCli(db, 8000, createNodePhysicalFileReader(), createConversationActivityPorts(db, { readControlPending: () => [] })), readConversationProjectId: readProject,
        internalDataContext: {}, diagnostics: { recordUnexpectedFailure: () => {} },
      });
      bridges.push(bridge);
      const query = async (argv: string[], internalDataAccess: 'allowed' | 'denied') => {
        const launch = createLaunch({ internalDataAccess });
        const prepared = createPreparedRuntime(launch);
        const scope = bridge.prepareExecution(launch);
        const runtime = scope.decorate(prepared.runtime);
        await runtime.start();
        const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
        const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
        if (!endpoint || !token) throw new Error('Missing test execution scope');
        const { frames } = await invoke({ endpoint, token, argv, core: true });
        prepared.terminal.resolve(createTerminal(launch));
        await runtime.terminal;
        const stdout = frames.flatMap(frame => frame.kind === 'plugin_cli_output' && frame.channel === 'stdout'
          ? [Buffer.from(frame.bytes_base64, 'base64').toString()] : []).join('');
        return { terminal: frames[frames.length - 1], stdout };
      };
      expect((await query(['changes', '--day', 'yesterday'], 'denied')).terminal)
        .toMatchObject({ code: 'permission_denied', exit_code: 77 });
      expect((await query(['changes', '--project', other], 'allowed')).terminal).toMatchObject({ exit_code: 2 });
      expect(readProject).not.toHaveBeenCalled();
      const { stdout } = await query(['changes', '--day', 'yesterday'], 'allowed');
      expect(JSON.parse(stdout)).toMatchObject({ truncated: false, changes: expect.arrayContaining([
        expect.objectContaining({ path: 'workspace:/one.md' }), expect.objectContaining({ path: 'workspace:/two.md' }),
      ]) });
      expect(stdout).not.toMatch(/today\.md|private\.md/u);
      expect(JSON.parse((await query(['changes', '--day', 'yesterday', '--limit', '1'], 'allowed')).stdout))
        .toMatchObject({ truncated: true, notice: expect.stringContaining('最近的一部分') });
      expect(readProject).toHaveBeenCalledWith('conversation-plugin-cli-bridge');
    } finally {
      await new Promise(resolve => setTimeout(resolve, 0));
      database.close();
    }
  });

  it('只在父 Shell start 后接纳 token，并把插件结果投影成真实 CLI frame', async () => {
    const execute = vi.fn(async () => ({ exitCode: 3, stdout: 'result\n', stderr: 'warning\n' }));
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'required',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute,
        },
      }),
    });
    const internalDataContext = { databaseService: { kind: 'workspace-db' } };
    const readConversationProjectId = vi.fn(async () => 'project-from-conversation');
    const bridge = await startBridge({ registration, internalDataContext, readConversationProjectId });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    await expect(invoke({ endpoint, token, argv: ['inspect'] }))
      .resolves.toEqual({ status: 401, frames: [] });

    const runtime = scope.decorate(prepared.runtime);
    await expect(runtime.start()).resolves.toMatchObject({ status: 'running' });
    await expect(invoke({ endpoint, token, argv: ['inspect', '--presentation', 'deck-1'] }))
      .resolves.toEqual({
        status: 200,
        frames: [
          expect.objectContaining({ kind: 'plugin_cli_output', channel: 'stdout' }),
          expect.objectContaining({ kind: 'plugin_cli_output', channel: 'stderr' }),
          expect.objectContaining({ kind: 'plugin_cli_terminal', exit_code: 3 }),
        ],
      });
    expect(execute).toHaveBeenCalledWith({
      conversationId: launch.proposal.identity.conversation_id,
      agentRunId: launch.proposal.identity.agent_run_id,
      projectId: 'project-from-conversation',
      hostContext: internalDataContext,
      signal: expect.any(AbortSignal),
    });
    expect(readConversationProjectId).toHaveBeenCalledExactlyOnceWith(launch.proposal.identity.conversation_id);

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
    await expect(invoke({ endpoint, token, argv: ['inspect'] }))
      .resolves.toEqual({ status: 401, frames: [] });
  });

  it('把超过旧字符上限的合法结果按 raw bytes 分帧且无损返回', async () => {
    const stdout = `${'诊断结果'.repeat(30_000)}\n`;
    const registration = registerCli({
      prepare: () => ({
        status: 'completed',
        result: { exitCode: 0, stdout, stderr: '' },
      }),
    });
    const bridge = await startBridge({ registration });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const result = await invoke({ endpoint, token, argv: ['diagnose'] });
    const outputFrames = result.frames.filter(frame => frame.kind === 'plugin_cli_output');
    const output = Buffer.concat(outputFrames.map(frame => Buffer.from(frame.bytes_base64, 'base64')));

    expect(outputFrames.length).toBeGreaterThan(1);
    expect(outputFrames.every(frame => (
      Buffer.from(frame.bytes_base64, 'base64').byteLength <= PLUGIN_CLI_OUTPUT_FRAME_BYTES
    ))).toBe(true);
    expect(output.toString('utf8')).toBe(stdout);
    expect(result.frames[result.frames.length - 1]).toMatchObject({
      kind: 'plugin_cli_terminal',
      exit_code: 0,
    });

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('总输出超过 bridge byte 预算时返回明确拒绝且不记为未知异常', async () => {
    const recordUnexpectedFailure = vi.fn();
    const registration = registerCli({
      prepare: () => ({
        status: 'completed',
        result: {
          exitCode: 0,
          stdout: 'x'.repeat(PLUGIN_CLI_MAX_OUTPUT_BYTES),
          stderr: 'x',
        },
      }),
    });
    const bridge = await startBridge({
      registration,
      diagnostics: { recordUnexpectedFailure },
    });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    await expect(invoke({ endpoint, token, argv: ['diagnose'] })).resolves.toEqual({
      status: 200,
      frames: [expect.objectContaining({
        kind: 'plugin_cli_failure',
        code: 'output_limit_exceeded',
        exit_code: 74,
      })],
    });
    expect(recordUnexpectedFailure).not.toHaveBeenCalled();

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('在插件接触 DB/worker 前拒绝超出父 Shell 权限的 access plan', async () => {
    const execute = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'required',
            conversationFiles: 'write',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute,
        },
      }),
    });
    const bridge = await startBridge({ registration });
    const launch = createLaunch({ permissionLevel: 'read_only', internalDataAccess: 'denied' });
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const result = await invoke({ endpoint, token, argv: ['render'] });
    expect(result).toEqual({
      status: 200,
      frames: [expect.objectContaining({
        kind: 'plugin_cli_failure',
        code: 'permission_denied',
        exit_code: 77,
      })],
    });
    expect(execute).not.toHaveBeenCalled();

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it.each([
    { permissionLevel: 'read_only', internalDataAccess: 'allowed', allowed: false },
    { permissionLevel: 'standard', internalDataAccess: 'denied', allowed: false },
    { permissionLevel: 'standard', internalDataAccess: 'allowed', allowed: true },
  ] as const)('内部资料写入继承两道父权限：$permissionLevel / $internalDataAccess', async permission => {
    const execute = vi.fn(async () => ({ exitCode: 0, stdout: 'updated\n', stderr: '' }));
    const readConversationProjectId = vi.fn(async () => 'current-project');
    const internalDataContext = { databaseService: { kind: 'workspace-db' } };
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'write',
            conversationFiles: 'none',
            externalFiles: 'denied', network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
          },
          execute,
        },
      }),
    });
    const bridge = await startBridge({ registration, internalDataContext, readConversationProjectId });
    const launch = createLaunch(permission);
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');
    const response = await invoke({ endpoint, token, argv: ['update'] });
    if (permission.allowed) {
      expect(response.frames[response.frames.length - 1]).toMatchObject({ kind: 'plugin_cli_terminal', exit_code: 0 });
      expect(readConversationProjectId).toHaveBeenCalledExactlyOnceWith(launch.proposal.identity.conversation_id);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'current-project', hostContext: internalDataContext }));
    } else {
      expect(response.frames).toEqual([expect.objectContaining({ kind: 'plugin_cli_failure', code: 'permission_denied', exit_code: 77 })]);
      expect(readConversationProjectId).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it.each(['none', 'read'] as const)(
    '仅声明会话文件读取的命令获得暂存能力：%s',
    async conversationFiles => {
      const close = vi.fn(async () => undefined);
      const stage = vi.fn(async () => ({
        file: { path: '/managed/copy', name: 'source.md', size: 1 },
        acceptFile() {},
      }));
      const createConversationInput = vi.fn(() => ({ stage, close }));
      const registration = registerCli({
        prepare: () => ({
          status: 'ready',
          plan: {
            access: {
              internalDataAccess: 'none',
              conversationFiles,
              externalFiles: 'denied',
              network: 'denied',
              guiControl: 'denied',
              localIpcControl: 'denied',
            },
            async execute(context) {
              expect(context.stageConversationFile).toBe(
                conversationFiles === 'read' ? stage : undefined
              );
              return { exitCode: 0, stdout: '', stderr: '' };
            },
          },
        }),
      });
      const bridge = await startBridge({ registration, createConversationInput });
      const launch = createLaunch({ permissionLevel: 'read_only' });
      const prepared = createPreparedRuntime(launch);
      const scope = bridge.prepareExecution(launch);
      const runtime = scope.decorate(prepared.runtime);
      await runtime.start();
      const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
      const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
      if (!endpoint || !token) throw new Error('bridge environment was not prepared');
      const response = await invoke({ endpoint, token, argv: ['import'] });
      expect(response.frames[response.frames.length - 1]).toMatchObject({ kind: 'plugin_cli_terminal', exit_code: 0 });
      expect(createConversationInput).toHaveBeenCalledTimes(conversationFiles === 'read' ? 1 : 0);
      expect(close).toHaveBeenCalledTimes(conversationFiles === 'read' ? 1 : 0);
      prepared.terminal.resolve(createTerminal(launch));
      await runtime.terminal;
    }
  );

  it.each([
    { level: 'read_only', declare: true, allowed: false },
    { level: 'standard', declare: true, allowed: true },
    { level: 'read_only', declare: false, allowed: true },
  ] as const)('Host推理显式声明且受父写权限约束：$level / $declare', async mode => {
    const embed = vi.fn(async () => ({ vectors: [[1]], spaceId: 'space' }));
    const host: PluginInferencePort = {
      embedding: { embed }, reranking: { async rerank() { throw new Error('unused'); } },
      textGeneration: { async generate() { throw new Error('unused'); } },
      documentOcr: { async resolveModelProfile() { return undefined; }, async recognizeDocument() { throw new Error('unused'); } },
    };
    const createInferenceSession = vi.fn((input: { operations: readonly ('embed' | 'text' | 'ocr-profile' | 'ocr')[]; signal: AbortSignal }) =>
      createPluginCliInferenceSession({ ...input, inference: host }));
    const execute = vi.fn<NonNullable<Extract<ReturnType<BackendPluginCliContribution['prepare']>, { status: 'ready' }>['plan']['execute']>>(async context => {
      if (mode.declare) {
        expect(context.modelPurposeSnapshot?.embeddingModelId).toBe('captured');
        if (!context.inference) throw new Error('missing inference grant');
        await context.inference.embedding.embed({ modelId: 'captured', values: ['source'] });
        await expect(context.inference.textGeneration.generate({ modelId: 'unused', messages: [] })).rejects.toThrow('未声明');
      } else {
        expect(context.inference).toBeUndefined();
        expect(context.modelPurposeSnapshot).toBeUndefined();
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const registration = registerCli({ prepare: () => ({ status: 'ready', plan: {
      access: { internalDataAccess: mode.declare ? 'write' : 'required', conversationFiles: 'none', externalFiles: 'denied', network: 'denied', guiControl: 'denied', localIpcControl: 'denied', ...(mode.declare ? { hostInference: ['embed'] } : {}) }, execute,
    } }) });
    const bridge = await startBridge({ registration, createInferenceSession });
    const launch = createLaunch({ permissionLevel: mode.level });
    const prepared = createPreparedRuntime(launch);
    const selection = { embeddingModelId: 'captured', pdfOcrModelId: null, imageVisionModelId: null, graphExtractionModelId: null };
    const scope = bridge.prepareExecution(launch, selection);
    selection.embeddingModelId = 'changed-after-admission';
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('missing bridge');
    const response = await invoke({ endpoint, token, argv: ['import'] });
    expect(response.frames[response.frames.length - 1]).toMatchObject(mode.allowed
      ? { kind: 'plugin_cli_terminal', exit_code: 0 }
      : { kind: 'plugin_cli_failure', code: 'permission_denied', exit_code: 77 });
    expect(createInferenceSession).toHaveBeenCalledTimes(mode.allowed && mode.declare ? 1 : 0);
    expect(embed).toHaveBeenCalledTimes(mode.allowed && mode.declare ? 1 : 0);
    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('未知插件异常只向 CLI 返回关联号，并把真实阶段和原因交给内部诊断', async () => {
    const cause = new Error('database worker is offline');
    const recordUnexpectedFailure = vi.fn();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute: async () => { throw cause; },
        },
      }),
    });
    const bridge = await startBridge({
      registration,
      diagnostics: { recordUnexpectedFailure },
      createCorrelationId: () => 'bridge-correlation-1',
    });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const result = await invoke({ endpoint, token, argv: ['inspect'] });

    expect(result).toEqual({
      status: 200,
      frames: [expect.objectContaining({
        kind: 'plugin_cli_failure',
        code: 'runtime_failure',
        exit_code: 70,
        message: 'Plugin CLI bridge failed unexpectedly. Reference: bridge-correlation-1.',
      })],
    });
    expect(JSON.stringify(result.frames)).not.toContain(cause.message);
    expect(recordUnexpectedFailure).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'bridge-correlation-1',
      stage: 'execute',
      identity: launch.proposal.identity,
      pluginId: 'slides',
      invocationId: `${launch.proposal.identity.command_execution_id}_cli_invocation-1`,
      error: cause,
    }));

    prepared.terminal.resolve(createTerminal(launch));
    await runtime.terminal;
  });

  it('父 Shell terminal 会撤销 token、abort invocation，并等待插件 lease 真正释放', async () => {
    const executeStarted = deferred<void>();
    const releaseCleanup = deferred<void>();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          async execute({ signal }) {
            executeStarted.resolve();
            await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {
              once: true,
            }));
            await releaseCleanup.promise;
            return { exitCode: 0, stdout: '', stderr: '' };
          },
        },
      }),
    });
    const bridge = await startBridge({ registration });
    const launch = createLaunch();
    const prepared = createPreparedRuntime(launch);
    const scope = bridge.prepareExecution(launch);
    const runtime = scope.decorate(prepared.runtime);
    await runtime.start();
    const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
    const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
    if (!endpoint || !token) throw new Error('bridge environment was not prepared');

    const invocation = invoke({ endpoint, token, argv: ['inspect'] });
    await executeStarted.promise;
    prepared.terminal.resolve(createTerminal(launch));
    let terminalSettled = false;
    void runtime.terminal.then(() => { terminalSettled = true; });
    await Promise.resolve();
    expect(terminalSettled).toBe(false);

    releaseCleanup.resolve();
    await expect(invocation).resolves.toEqual({
      status: 200,
      frames: [expect.objectContaining({ kind: 'plugin_cli_failure', code: 'cancelled' })],
    });
    await runtime.terminal;
    expect(terminalSettled).toBe(true);
  });

  describe('内建 palette', () => {
    const paletteDatabases: DatabaseService[] = [];
    afterEach(() => {
      for (const database of paletteDatabases.splice(0)) database.close();
    });

    async function createPaletteHarness() {
      const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-palette-cli-')));
      temporaryRoots.push(root);
      const image = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#4e7a68' } }).png().toBuffer();
      await fsp.writeFile(path.join(root, 'cover.png'), image);
      // “最近用过”记在工作区库里：用正式 DatabaseService 建库，表由 color-palette 的 schema provider 建立。
      const database = new DatabaseService(':memory:');
      database.initialize();
      paletteDatabases.push(database);
      const bridge = await startPluginCliShellBridgeRuntime({
        resolveCli: () => { throw new Error('Core commands must not resolve a plugin'); },
        coreCli: createCoreCli(database.getDb(), 8000, createNodePhysicalFileReader(), { runs: { readCandidates: async () => { throw new Error('unused'); } }, approvals: { readControlPending: () => { throw new Error('unused'); } } }),
        internalDataContext: {},
        diagnostics: { recordUnexpectedFailure: ({ error }) => { throw error; } },
      });
      bridges.push(bridge);
      const run = async (
        argv: string[],
        permissionLevel: 'read_only' | 'standard' = 'standard',
        internalDataAccess: 'allowed' | 'denied' = 'allowed',
      ) => {
        const launch = createLaunch({ permissionLevel, internalDataAccess, conversationRoot: root });
        const prepared = createPreparedRuntime(launch);
        const scope = bridge.prepareExecution(launch);
        const runtime = scope.decorate(prepared.runtime);
        await runtime.start();
        const endpoint = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_ENDPOINT_ENV];
        const token = scope.internalEnvironment[LINNYA_INTERNAL_PLUGIN_CLI_TOKEN_ENV];
        if (!endpoint || !token) throw new Error('Missing test execution scope');
        const { frames } = await invoke({ endpoint, token, argv: ['palette', ...argv], core: true });
        prepared.terminal.resolve(createTerminal(launch));
        await runtime.terminal;
        const text = (channel: 'stdout' | 'stderr') => frames.flatMap(frame => frame.kind === 'plugin_cli_output' && frame.channel === channel
          ? [Buffer.from(frame.bytes_base64, 'base64').toString()] : []).join('');
        return { terminal: frames[frames.length - 1], stdout: text('stdout'), stderr: text('stderr') };
      };
      return { root, run };
    }

    it('suggest 读写工作区的最近用过：内部数据关闭或只读时拒绝，标准档从工作目录读图出配色', async () => {
      const { run } = await createPaletteHarness();
      expect((await run(['suggest', 'cover.png'], 'standard', 'denied')).terminal)
        .toMatchObject({ code: 'permission_denied', exit_code: 77 });
      expect((await run(['suggest', 'cover.png'], 'read_only')).terminal)
        .toMatchObject({ code: 'permission_denied', exit_code: 77 });
      const result = await run(['suggest', 'cover.png', 'conversation:/cover.png', '--json']);
      expect(result.terminal).toMatchObject({ kind: 'plugin_cli_terminal', exit_code: 0 });
      const parsed: unknown = JSON.parse(result.stdout);
      const { skippedImages, ...suggestion } = parsed as { skippedImages: string[] };
      expect(ColorPaletteSuggestionSchema.parse(suggestion).palettes).toHaveLength(3);
      expect(skippedImages).toEqual([]);
    });

    it('工作目录外的来源一律读不出，符号链接也带不出去', async () => {
      const { root, run } = await createPaletteHarness();
      const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-palette-outside-')));
      temporaryRoots.push(outside);
      await fsp.copyFile(path.join(root, 'cover.png'), path.join(outside, 'secret.png'));
      await fsp.symlink(path.join(outside, 'secret.png'), path.join(root, 'link.png'));
      const result = await run([
        'suggest', 'link.png', '../secret.png', `file://${outside}/secret.png`, 'workspace:/a.png', 'missing.png', 'cover.png',
      ]);
      expect(result.terminal).toMatchObject({ exit_code: 0 });
      expect(result.stdout.split('\n')[0]).toContain('读不出 link.png ../secret.png');
      expect(result.stdout.split('\n')[0]).toContain('missing.png');

      const allBad = await run(['suggest', 'link.png']);
      expect(allBad.terminal).toMatchObject({ exit_code: 1 });
      expect(allBad.stderr).toMatch(/^image_unreadable /u);
    });

    it('--preview 需要写权限，写出的 PNG 在工作目录内且不跟随链接', async () => {
      const { root, run } = await createPaletteHarness();
      expect((await run(['suggest', 'cover.png', '--preview'], 'read_only')).terminal)
        .toMatchObject({ code: 'permission_denied', exit_code: 77 });
      const result = await run(['suggest', 'cover.png', '--preview', '--n', '2']);
      const locator = /预览 conversation:\/(\S+?)（/u.exec(result.stdout)?.[1];
      if (!locator) throw new Error(`no preview in ${result.stdout}`);
      expect(locator).not.toContain('/');
      const metadata = await sharp(path.join(root, locator)).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(1200);
    });

    it('check 用退出码区分合格与否，用法错误与业务错误分开', async () => {
      const { run } = await createPaletteHarness();
      const roles = ['--bg', 'ffffff', '--sf', 'f2f2f2', '--mu', '555555', '--ac', '1f3a5f', '--ch', '112233,445566,778899'];
      // check 只算颜色，不读写任何数据，只读、内部数据关闭时都能用。
      const good = await run(['check', ...roles, '--ink', '111111'], 'read_only', 'denied');
      expect(good).toMatchObject({ stdout: '通过\n', terminal: { exit_code: 0 } });
      const bad = await run(['check', ...roles, '--ink', 'bbbbbb']);
      expect(bad.terminal).toMatchObject({ exit_code: 1 });
      expect(bad.stdout).toContain('ink_contrast ink #bbbbbb');
      expect(bad.stdout).toContain('建议 bg#ffffff');
      expect((await run(['check', '--bg'])).terminal).toMatchObject({ exit_code: 2 });
      const failed = await run(['suggest', '--seed', '4e7a68', '--rng', 'nonsense']);
      expect(failed.terminal).toMatchObject({ exit_code: 1 });
      expect(failed.stderr).toMatch(/^invalid_rng /u);
    });

    it('use 记下选用的一套，之后的建议少给这个组合；编号不对时给稳定错误码', async () => {
      const { run } = await createPaletteHarness();
      const suggested = await run(['suggest', 'cover.png', '--n', '2']);
      const paletteId = /^(pl[0-9a-z]{4}-1) /mu.exec(suggested.stdout)?.[1];
      if (!paletteId) throw new Error(`no palette id in ${suggested.stdout}`);

      expect((await run(['use', paletteId], 'read_only')).terminal).toMatchObject({ code: 'permission_denied', exit_code: 77 });
      const used = await run(['use', paletteId]);
      expect(used.terminal).toMatchObject({ exit_code: 0 });
      expect(used.stdout).toMatch(new RegExp(`^已记下 ${paletteId} (浅底|染纸|深底)·\\S+；`, 'u'));

      const missing = await run(['use', 'pl0000-1']);
      expect(missing.terminal).toMatchObject({ exit_code: 1 });
      expect(missing.stderr).toMatch(/^palette_not_found /u);
      expect((await run(['use'])).terminal).toMatchObject({ exit_code: 2 });
    });

    it.runIf(Boolean(process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH))('真实 native client 以 linnya 身份调用 palette', async () => {
      const nativeClientPath = process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH;
      if (!nativeClientPath) throw new Error('native client path is required');
      const { root } = await createPaletteHarness();
      const bridge = bridges[bridges.length - 1];
      if (!bridge) throw new Error('bridge is required');
      const launch = createLaunch({ conversationRoot: root });
      const prepared = createPreparedRuntime(launch);
      const scope = bridge.prepareExecution(launch);
      const runtime = scope.decorate(prepared.runtime);
      await runtime.start();
      const facadeRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-palette-native-'));
      temporaryRoots.push(facadeRoot);
      const facadePath = path.join(facadeRoot, 'linnya');
      await fsp.copyFile(path.resolve(nativeClientPath), facadePath);
      await fsp.chmod(facadePath, 0o700);
      const result = await runNativeFacade({
        executablePath: facadePath,
        argv: ['palette', 'suggest', 'cover.png', '--color', '1F3A5F', '--accents', '3'],
        internalEnvironment: scope.internalEnvironment,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('#1f3a5f(指定)');
      expect(result.stdout.trimEnd().split('\n')).toHaveLength(4);
      prepared.terminal.resolve(createTerminal(launch));
      await runtime.terminal;
    });
  });

  it.runIf(Boolean(process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH))(
    '真实 native thin client 保留 argv/stdout/stderr/exit code，并且不启动 Electron',
    async () => {
      const nativeClientPath = process.env.LINNYA_PLUGIN_CLI_NATIVE_CLIENT_E2E_PATH;
      if (!nativeClientPath) throw new Error('native client path is required');
      const nativeStdout = `${'native large output\n'.repeat(8_000)}`;
      const observedArgv: string[][] = [];
      const registration = registerCli({
        prepare({ argv }) {
          observedArgv.push([...argv]);
          return {
            status: 'completed',
            result: { exitCode: 23, stdout: nativeStdout, stderr: 'native stderr\n' },
          };
        },
      });
      const bridge = await startBridge({ registration });
      const launch = createLaunch();
      const prepared = createPreparedRuntime(launch);
      const scope = bridge.prepareExecution(launch);
      const runtime = scope.decorate(prepared.runtime);
      await runtime.start();

      const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-cli-native-e2e-'));
      temporaryRoots.push(root);
      const facadePath = path.join(root, process.platform === 'win32'
        ? 'linnya-slides.exe'
        : 'linnya-slides');
      await fsp.copyFile(path.resolve(nativeClientPath), facadePath);
      if (process.platform !== 'win32') await fsp.chmod(facadePath, 0o700);

      const result = await runNativeFacade({
        executablePath: facadePath,
        argv: [
          'inspect',
          '--presentation',
          'deck with spaces',
          '',
          '"quoted"',
          'line one\nline two',
          '中文参数',
        ],
        internalEnvironment: scope.internalEnvironment,
      });
      expect(result).toEqual({
        exitCode: 23,
        stdout: nativeStdout,
        stderr: 'native stderr\n',
      });
      expect(observedArgv).toEqual([
        [
          'inspect',
          '--presentation',
          'deck with spaces',
          '',
          '"quoted"',
          'line one\nline two',
          '中文参数',
        ],
      ]);

      prepared.terminal.resolve(createTerminal(launch));
      await runtime.terminal;
    },
  );
});
