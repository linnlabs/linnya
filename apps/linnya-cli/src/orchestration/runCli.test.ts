import { describe, expect, it, vi } from 'vitest';
import type {
  ConversationControlClient,
  ConversationControlConnectionPort,
} from '../definitions/cli';
import { runCli } from './runCli';

function createIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      write: (text: string) => { stdout += text; },
      writeError: (text: string) => { stderr += text; },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function createClient(
  execute: ConversationControlClient['execute'],
): ConversationControlClient {
  return {
    descriptor: {
      protocol_version: 1,
      app_instance_id: 'app-1',
      pid: 42,
      host: '127.0.0.1',
      port: 43123,
      session_token: 'a'.repeat(64),
      created_at: 1,
      updated_at: 1,
    },
    handshake: {
      schema_version: 1,
      protocol_version: 1,
      app_instance_id: 'app-1',
      app_version: '0.0.38',
      capabilities: [
        'send', 'models', 'list', 'messages', 'status', 'respond', 'stop', 'result',
        'workspace_tools',
      ],
      limits: {
        max_request_bytes: 1024 * 1024,
        max_message_chars: 200_000,
        max_page_size: 200,
        min_watch_interval_ms: 1,
        max_watch_timeout_ms: 10_000,
      },
    },
    execute,
  };
}

function connect(client: ConversationControlClient): ConversationControlConnectionPort {
  return { connect: async () => client };
}

describe('runCli', () => {
  it('工具调用等待 run 与投影结算，并返回同一工具卡的完整结果', async () => {
    let statusCalls = 0;
    const execute: ConversationControlClient['execute'] = async request => {
      if (request.command === 'workspace_tools') {
        return {
          schema_version: 1,
          ok: true,
          command: 'workspace_tools',
          action: 'call',
          tool_name: 'read_file',
          receipt: {
            conversation_id: 'conversation-1',
            user_message_id: 'message-1',
            turn_id: 'turn-1',
            run_id: 'run-1',
            execution_id: 'execution-1',
            agent_id: 'default',
            accepted_at: 1,
          },
        };
      }
      if (request.command === 'status') {
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
            agent_id: 'default',
            status: statusCalls === 1 ? 'running' : 'completed',
            started_at: 1,
            updated_at: statusCalls === 1 ? 2 : 3,
            terminal_at: statusCalls === 1 ? undefined : 3,
            result_available: false,
          },
        };
      }
      if (request.command === 'messages') {
        return {
          schema_version: 1,
          ok: true,
          command: 'messages',
          status: 'ready',
          conversation_id: request.conversation_id,
          messages: [{
            message_id: 'tool-message-1',
            conversation_id: request.conversation_id,
            turn_id: 'turn-1',
            sort_seq: 2,
            timestamp: 3,
            content: 'file contents',
            merge_key: 'tool:run-1:call-1',
            presentation: null,
            run_id: 'run-1',
            role: 'assistant',
            message_type: 'tool_calls',
            payload: {
              tool_call_id: 'call-1',
              tool_name: 'read_file',
              status: 'success',
              phase: 'complete',
              data: { content: 'file contents' },
              started_at: 2,
              completed_at: 3,
            },
          }],
          has_more_before: false,
          has_more_after: false,
          revision: 2,
        };
      }
      throw new Error(`unexpected command ${request.command}`);
    };
    const output = createIo();
    await expect(runCli([
      'tools', 'call', 'read_file',
      '--conversation', 'conversation-1',
      '--args-json', '{"locator":"workspace:/notes.md"}',
      '--interval', '1',
      '--timeout', '1000',
    ], {
      connection: connect(createClient(execute)),
      io: output.io,
      now: () => 10,
      sleep: async () => undefined,
    })).resolves.toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({
      ok: true,
      conversation_id: 'conversation-1',
      run_id: 'run-1',
      tool: { payload: { tool_name: 'read_file', status: 'success' } },
    });
    expect(output.stderr()).toBe('');
  });

  it('models 输出可复制到 send 参数的模型配置 ID', async () => {
    const execute: ConversationControlClient['execute'] = async request => {
      if (request.command !== 'models') throw new Error('unexpected command');
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
    };
    const output = createIo();
    await expect(runCli(['models'], {
      connection: connect(createClient(execute)),
      io: output.io,
    })).resolves.toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({
      command: 'models',
      chat: [{ model_config_id: 'model-config-1', available: true }],
    });
    expect(output.stderr()).toBe('');
  });

  it('单次命令只向 stdout 写一个稳定 JSON 结果', async () => {
    const execute: ConversationControlClient['execute'] = async request => {
      if (request.command !== 'list') throw new Error('unexpected command');
      return {
        schema_version: 1,
        ok: true,
        command: 'list',
        conversations: [],
        has_more: false,
      };
    };
    const output = createIo();
    await expect(runCli(['list'], {
      connection: connect(createClient(execute)),
      io: output.io,
    })).resolves.toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({ command: 'list', ok: true });
    expect(output.stderr()).toBe('');
  });

  it('watch 只在状态变化时写 JSONL，并在 awaiting_user 返回控制权', async () => {
    let callCount = 0;
    const execute: ConversationControlClient['execute'] = async request => {
      if (request.command !== 'status') throw new Error('unexpected command');
      callCount += 1;
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
          status: callCount < 3 ? 'running' : 'awaiting_user',
          started_at: 1,
          updated_at: callCount < 3 ? 2 : 3,
          pending_interaction: callCount < 3 ? undefined : {
            interaction_id: 'interaction-1',
            tool_name: 'ask',
          },
          result_available: false,
        },
      };
    };
    const output = createIo();
    const sleep = vi.fn(async () => undefined);
    await expect(runCli([
      'status', 'conversation-1', '--watch', '--interval', '1', '--timeout', '1000',
    ], {
      connection: connect(createClient(execute)),
      io: output.io,
      now: () => 10,
      sleep,
    })).resolves.toBe(0);
    const frames = output.stdout().trim().split('\n').map(line => JSON.parse(line));
    expect(frames).toHaveLength(2);
    expect(frames.map(frame => frame.snapshot.status)).toEqual(['running', 'awaiting_user']);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('参数错误不连接 App，并以稳定错误 JSON 和 usage exit code 退出', async () => {
    const output = createIo();
    const connection: ConversationControlConnectionPort = { connect: vi.fn() };
    await expect(runCli(['pause', 'conversation-1'], {
      connection,
      io: output.io,
    })).resolves.toBe(2);
    expect(connection.connect).not.toHaveBeenCalled();
    expect(JSON.parse(output.stderr())).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
  });
});
