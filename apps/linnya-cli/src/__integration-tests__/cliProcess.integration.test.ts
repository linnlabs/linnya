import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_CONNECTION_FILE_ENV,
  CONVERSATION_CONTROL_TOKEN_HEADER,
  ConversationControlCommandRequestSchema,
  ConversationControlConnectionDescriptorSchema,
  type ConversationControlCommandRequest,
} from '@app/schemas';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const cliEntry = path.join(repoRoot, 'apps/linnya-cli/src/main.ts');
const servers: Server[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  await Promise.all(
    temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
  );
});

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const decoded: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return decoded;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function createScriptedBridge(
  execute: (request: ConversationControlCommandRequest) => unknown,
): Promise<{
  readonly connectionFile: string;
  readonly receivedCommands: ConversationControlCommandRequest[];
}> {
  const sessionToken = 'd'.repeat(64);
  const receivedCommands: ConversationControlCommandRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers[CONVERSATION_CONTROL_TOKEN_HEADER] !== sessionToken) {
        sendJson(response, 401, { error: 'unauthorized' });
        return;
      }
      if (request.url?.endsWith('/handshake')) {
        await readJsonRequest(request);
        sendJson(response, 200, {
          schema_version: 1,
          protocol_version: 1,
          app_instance_id: 'app-process-test',
          app_version: '0.0.38',
          capabilities: [
            'send', 'models', 'projects', 'list', 'messages', 'status', 'respond', 'stop', 'result',
            'audit', 'workspace_tools',
          ],
          limits: {
            max_request_bytes: 1024 * 1024,
            max_message_chars: 200_000,
            max_page_size: 200,
            min_watch_interval_ms: 1,
            max_watch_timeout_ms: 10_000,
          },
        });
        return;
      }
      if (request.url?.endsWith('/commands')) {
        const command = ConversationControlCommandRequestSchema.parse(await readJsonRequest(request));
        receivedCommands.push(command);
        sendJson(response, 200, execute(command));
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    })().catch(error => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'scripted_bridge_failure',
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Scripted bridge address unavailable');

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-process-'));
  temporaryRoots.push(temporaryRoot);
  const connectionFile = path.join(temporaryRoot, 'connection.json');
  const descriptor = ConversationControlConnectionDescriptorSchema.parse({
    protocol_version: 1,
    app_instance_id: 'app-process-test',
    pid: process.pid,
    host: '127.0.0.1',
    port: address.port,
    session_token: sessionToken,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await fs.writeFile(connectionFile, JSON.stringify(descriptor), { mode: 0o600 });
  return { connectionFile, receivedCommands };
}

function runCliProcess(
  args: readonly string[],
  connectionFile: string,
): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        [CONVERSATION_CONTROL_CONNECTION_FILE_ENV]: connectionFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
}

describe('linnya CLI real process -> scripted bridge', () => {
  it('真实子进程查询严格受限的 Workspace 工具目录', async () => {
    const bridge = await createScriptedBridge(request => {
      if (request.command !== 'workspace_tools' || request.action !== 'list') {
        throw new Error('expected workspace_tools list command');
      }
      return {
        schema_version: 1,
        ok: true,
        command: 'workspace_tools',
        action: 'list',
        tools: [{
          name: 'read_file',
          description: 'Read one Workspace file',
        }],
      };
    });
    const result = await runCliProcess(['tools', 'list'], bridge.connectionFile);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'workspace_tools',
      action: 'list',
      tools: [{ name: 'read_file' }],
    });
    expect(bridge.receivedCommands).toEqual([{
      schema_version: 1,
      command: 'workspace_tools',
      action: 'list',
    }]);
  });

  it('真实子进程列举可用于写入的项目 ID', async () => {
    const bridge = await createScriptedBridge(request => {
      if (request.command !== 'projects') throw new Error('expected projects command');
      return { schema_version: 1, ok: true, command: 'projects',
        projects: [{ project_id: 'project-1', name: '演示文稿' }] };
    });
    const result = await runCliProcess(['projects'], bridge.connectionFile);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'projects', projects: [{ project_id: 'project-1', name: '演示文稿' }],
    });
    expect(bridge.receivedCommands).toEqual([{ schema_version: 1, command: 'projects' }]);
  });

  it('真实子进程查询当前 App 的可调用模型', async () => {
    const bridge = await createScriptedBridge(request => {
      if (request.command !== 'models') throw new Error('expected models command');
      return {
        schema_version: 1,
        ok: true,
        command: 'models',
        chat: [{
          model_config_id: 'model-config-1',
          model_name: 'gpt-5.6-sol',
          display_name: 'GPT-5.6 Sol',
          catalog_source: 'account',
          available: true,
          input_support: { user_image: true, tool_result_image: true },
        }],
        image_generation: [],
      };
    });
    const result = await runCliProcess(['models'], bridge.connectionFile);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'models',
      chat: [{ model_config_id: 'model-config-1' }],
    });
    expect(bridge.receivedCommands).toEqual([{ schema_version: 1, command: 'models' }]);
  });

  it('真实子进程完成握手、发送命令并只输出 accepted receipt', async () => {
    const bridge = await createScriptedBridge(request => {
      if (request.command !== 'send') throw new Error('expected send command');
      return {
        schema_version: 1,
        ok: true,
        command: 'send',
        receipt: {
          conversation_id: 'conversation-1',
          user_message_id: 'event-1',
          turn_id: 'turn-1',
          run_id: 'run-1',
          execution_id: 'execution-1',
          agent_id: 'plugin_agent_fixture',
          accepted_at: 100,
        },
      };
    });
    const result = await runCliProcess([
      'send', '生成一份三页产品介绍 PPT', '--agent', 'plugin_agent_fixture',
      '--image-model', 'chatgpt-subscription-gpt-image-2',
    ], bridge.connectionFile);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'send',
      receipt: { run_id: 'run-1', agent_id: 'plugin_agent_fixture' },
    });
    expect(bridge.receivedCommands).toMatchObject([{
      command: 'send',
      message: '生成一份三页产品介绍 PPT',
      selected_agent_id: 'plugin_agent_fixture',
      image_generation_model_id: 'chatgpt-subscription-gpt-image-2',
    }]);
  });

  it('messages 默认查询发送不带 cursor 的 tail 窗口', async () => {
    const bridge = await createScriptedBridge(request => {
      if (request.command !== 'messages') throw new Error('expected messages command');
      return {
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: request.conversation_id,
        status: 'ready',
        messages: [],
        has_more_before: false,
        has_more_after: false,
        revision: 0,
      };
    });
    const result = await runCliProcess([
      'messages', 'conversation-1',
    ], bridge.connectionFile);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'messages',
      status: 'ready',
    });
    expect(bridge.receivedCommands).toEqual([{
      schema_version: 1,
      command: 'messages',
      conversation_id: 'conversation-1',
      limit: 80,
      window: 'tail',
    }]);
  });

  it('status --watch 输出状态变化 JSONL，并在完成态退出', async () => {
    let statusCalls = 0;
    const bridge = await createScriptedBridge(request => {
      if (request.command !== 'status') throw new Error('expected status command');
      statusCalls += 1;
      return {
        schema_version: 1,
        ok: true,
        command: 'status',
        conversation_id: request.conversation_id,
        run: {
          conversation_id: request.conversation_id,
          run_id: 'run-1',
          turn_id: 'turn-1',
          execution_id: 'execution-1',
          agent_id: 'plugin_agent_fixture',
          status: statusCalls === 1 ? 'running' : 'completed',
          started_at: 1,
          updated_at: statusCalls,
          terminal_at: statusCalls === 1 ? undefined : 2,
          result_available: statusCalls > 1,
        },
      };
    });
    const result = await runCliProcess([
      'status', 'conversation-1', '--watch', '--interval', '1', '--timeout', '1000',
    ], bridge.connectionFile);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const frames = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(frames.map(frame => frame.snapshot.status)).toEqual(['running', 'completed']);
    expect(statusCalls).toBe(2);
  });

  it('Host 业务冲突只写 stderr，并映射稳定 conflict exit code', async () => {
    const bridge = await createScriptedBridge(request => ({
      schema_version: 1,
      ok: false,
      command: request.command,
      error: {
        code: 'conversation_busy',
        message: 'Conversation already has an active run',
        retryable: true,
      },
    }));
    const result = await runCliProcess([
      'send', '继续生成', '--conversation', 'conversation-1',
    ], bridge.connectionFile);

    expect(result.exitCode).toBe(6);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      command: 'send',
      error: { code: 'conversation_busy', retryable: true },
    });
  });

  it('audit 通过真实子进程读取安全执行摘要', async () => {
    const bridge = await createScriptedBridge(request => {
      if (request.command !== 'audit') throw new Error('expected audit command');
      return {
        schema_version: 1,
        ok: true,
        command: 'audit',
        conversation_id: request.conversation_id,
        requested_run_id: request.run_id,
        generated_at: 300,
        completeness: {
          run_registry: 'complete',
          event_store: 'complete',
          telemetry: 'best_effort',
          telemetry_retention_days: 7,
        },
        source_window: { telemetry_events: 0, event_facts: 0 },
        runs: [],
        llm: {
          calls: 0,
          duration_ms: 0,
          provider_actual_calls: 0,
          estimate_calls: 0,
          missing_usage_calls: 0,
          actual_tokens: { input_tokens: 0, output_tokens: 0 },
          by_model: [],
        },
        tools: { calls: 0, failed_calls: 0, duration_ms: 0, by_tool: [] },
        tool_pairing: {
          complete: true,
          paired: 0,
          decision_missing: 0,
          terminal_missing: 0,
          duplicate_terminal: 0,
          name_mismatches: 0,
          records: [],
        },
        commands: {
          executions: 0,
          terminal_observations: 0,
          nonzero_exit_executions: 0,
          runtime_failure_executions: 0,
          by_execution: [],
        },
        context_compaction: {
          observations: 2,
          attempts: 1,
          completed: 1,
          failed: 0,
          insufficient: 1,
          aborted: 0,
          skipped: 0,
          duration_ms: 80,
          provider_actual_calls: 1,
          estimate_calls: 0,
          missing_usage_calls: 0,
          actual_tokens: { input_tokens: 60, output_tokens: 8 },
          by_run: [{
            run_id: 'run-1',
            observations: 2,
            attempts: 1,
            completed: 1,
            failed: 0,
            insufficient: 1,
            aborted: 0,
            skipped: 0,
            duration_ms: 80,
            max_compactions_per_run: 12,
            provider_actual_calls: 1,
            estimate_calls: 0,
            missing_usage_calls: 0,
            actual_tokens: { input_tokens: 60, output_tokens: 8 },
            events: [{
              emitted_at: 200,
              model_id: 'model-a',
              compaction_index: 1,
              max_compactions_per_run: 12,
              generation_attempted: true,
              trigger_ratio: 0.8,
              target_ratio: 0.5,
              before_tokens: 100,
              input_budget_tokens: 120,
              compaction_input_tokens: 60,
              after_tokens: 50,
              replaced_message_count: 8,
              replaced_tool_group_count: 2,
              kept_tool_group_count: 2,
              summary_output_tokens: 8,
              duration_ms: 80,
              outcome: 'completed',
              forced_phase_recovery: false,
            }, {
              emitted_at: 210,
              model_id: 'model-a',
              compaction_index: 2,
              max_compactions_per_run: 12,
              generation_attempted: false,
              trigger_ratio: 0.8,
              target_ratio: 0.5,
              before_tokens: 121,
              input_budget_tokens: 120,
              replaced_message_count: 0,
              replaced_tool_group_count: 0,
              kept_tool_group_count: 2,
              duration_ms: 0,
              outcome: 'insufficient',
              forced_phase_recovery: false,
              failure_reason: 'CONTEXT_COMPACTION_NO_REPLACEABLE_RANGE',
            }],
          }],
        },
        run_lifecycle: { by_run: [] },
      };
    });
    const result = await runCliProcess([
      'audit', 'conversation-1', '--run', 'run-1',
    ], bridge.connectionFile);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: 'audit',
      requested_run_id: 'run-1',
      completeness: { telemetry: 'best_effort' },
      context_compaction: {
        observations: 2,
        attempts: 1,
        missing_usage_calls: 0,
        by_run: [{
          events: [
            { generation_attempted: true },
            { generation_attempted: false },
          ],
        }],
      },
    });
    expect(bridge.receivedCommands).toMatchObject([{
      command: 'audit',
      conversation_id: 'conversation-1',
      run_id: 'run-1',
    }]);
  });

  it('App 未运行时不打印诊断噪声，只返回 app_not_running 合同', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-missing-app-'));
    temporaryRoots.push(temporaryRoot);
    const result = await runCliProcess(['list'], path.join(temporaryRoot, 'missing.json'));

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: 'app_not_running', retryable: true },
    });
  });
});
