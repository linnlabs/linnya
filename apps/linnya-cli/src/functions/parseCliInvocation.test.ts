import { describe, expect, it } from 'vitest';
import { parseCliInvocation } from './parseCliInvocation';

describe('parseCliInvocation', () => {
  it('拒绝两种参数来源同时出现', () => {
    expect(() => parseCliInvocation(['tools', 'call', 'write_file', '--project', 'p',
      '--args-file', 'args.json', '--args-json', '{}'])).toThrow('mutually exclusive');
  });
  it('只接受五个 Workspace 工具，并要求调用绑定项目或会话', () => {
    expect(parseCliInvocation(['tools', 'list'])).toMatchObject({
      request: { command: 'workspace_tools', action: 'list' },
    });
    expect(parseCliInvocation(['tools', 'describe', 'edit_file'])).toMatchObject({
      request: { action: 'describe', tool_name: 'edit_file' },
    });
    expect(parseCliInvocation([
      'tools', 'call', 'write_file',
      '--project', 'project-1',
      '--args-json', '{"locator":"workspace:/notes.md","content":"# Notes"}',
    ])).toMatchObject({
      kind: 'workspace-tool-call',
      request: {
        action: 'call',
        tool_name: 'write_file',
        project_id: 'project-1',
        args: { locator: 'workspace:/notes.md', content: '# Notes' },
      },
    });
    expect(() => parseCliInvocation([
      'tools', 'call', 'shell', '--project', 'project-1',
    ])).toThrow();
    expect(() => parseCliInvocation([
      'tools', 'call', 'read_file', '--args-json', '{}',
    ])).toThrow('workspace tool call requires conversation_id or project_id');
  });

  it('把 models 投影成无参数的窄查询合同', () => {
    expect(parseCliInvocation(['models'])).toEqual({
      kind: 'command',
      request: { schema_version: 1, command: 'models' },
      pretty: false,
    });
    expect(() => parseCliInvocation(['models', 'gpt'])).toThrow(
      'models does not accept positional arguments',
    );
  });

  it('把新消息和产品级 Agent 选择投影成窄 send 合同', () => {
    expect(parseCliInvocation([
      'send',
      '生成一份简洁的三页产品介绍 PPT',
      '--agent',
      'plugin_agent_fixture',
      '--project',
      'project-1',
      '--image-model',
      'chatgpt-subscription-gpt-image-2',
      '--reasoning',
      'medium',
    ])).toMatchObject({
      kind: 'command',
      request: {
        command: 'send',
        message: '生成一份简洁的三页产品介绍 PPT',
        selected_agent_id: 'plugin_agent_fixture',
        project_id: 'project-1',
        image_generation_model_id: 'chatgpt-subscription-gpt-image-2',
        reasoning_effort: 'medium',
      },
    });
  });

  it('用同一个 send 命令向已有会话发送新消息', () => {
    expect(parseCliInvocation([
      'send',
      '把封面改成深色',
      '--conversation',
      'conversation-1',
    ])).toMatchObject({
      request: {
        command: 'send',
        conversation_id: 'conversation-1',
        message: '把封面改成深色',
      },
    });
  });

  it('表达消息分页和被动 wait-user 响应，不暴露 resume token', () => {
    expect(parseCliInvocation([
      'messages',
      'conversation-1',
    ])).toMatchObject({
      request: { command: 'messages', window: 'tail', limit: 80 },
    });
    expect(parseCliInvocation([
      'messages',
      'conversation-1',
    ])).not.toHaveProperty('request.cursor');
    expect(parseCliInvocation([
      'messages',
      'conversation-1',
      '--before',
      '42',
      '--limit',
      '20',
    ])).toMatchObject({
      request: { command: 'messages', window: 'before', cursor: 42, limit: 20 },
    });
    expect(() => parseCliInvocation([
      'messages', 'conversation-1', '--run', 'run-1',
    ])).toThrow('Unknown option for this command: --run');
    expect(parseCliInvocation([
      'respond',
      'conversation-1',
      '--interaction',
      'interaction-1',
      '--submit-json',
      '{"theme":"minimal"}',
    ])).toMatchObject({
      request: {
        command: 'respond',
        expected_interaction_id: 'interaction-1',
        response: { kind: 'submit', value: { theme: 'minimal' } },
      },
    });
  });

  it('只有 status watch，没有主动 pause 命令或破坏 JSONL 的 pretty watch', () => {
    expect(parseCliInvocation([
      'status',
      'conversation-1',
      '--watch',
      '--interval',
      '500',
    ])).toMatchObject({ kind: 'status', watch: true, intervalMs: 500 });
    expect(() => parseCliInvocation(['pause', 'conversation-1'])).toThrow('Unknown command');
    expect(() => parseCliInvocation([
      'status', 'conversation-1', '--watch', '--pretty',
    ])).toThrow('--pretty cannot be combined');
  });
});
