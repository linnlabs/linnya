import { describe, expect, it } from 'vitest';

import { projectCommandExecutionCompactStep } from './projectCommandExecutionPresentation';

const PROCESS_HANDLE = 'command_process_123e4567-e89b-42d3-a456-426614174000';

describe('projectCommandExecutionCompactStep', () => {
  it('shell 标题保留命令正文', () => {
    expect(projectCommandExecutionCompactStep({
      sourceToolName: 'shell',
      uiKey: 'shell',
      toolCallId: 'shell-call-1',
      args: { command: 'pnpm test' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toEqual({
      title: {
        key: 'conversation.tool.command.compact.shell',
        fallback: '运行命令“{command}”',
        params: { command: 'pnpm test' },
      },
    });
  });

  it.each([
    [{ type: 'poll', cursor: 0 }, 'conversation.tool.command.compact.process.poll', '查看命令输出'],
    [{ type: 'wait', cursor: 0, wait_timeout_ms: 1_000 }, 'conversation.tool.command.compact.process.wait', '等待命令完成'],
    [{ type: 'cancel' }, 'conversation.tool.command.compact.process.cancel', '终止命令'],
    [{ type: 'write', input: 'yes' }, 'conversation.tool.command.compact.process.write', '向命令输入内容'],
    [{ type: 'submit', input: 'yes' }, 'conversation.tool.command.compact.process.submit', '向命令输入内容'],
    [{ type: 'eof' }, 'conversation.tool.command.compact.process.eof', '结束命令输入'],
    [{ type: 'resize', columns: 120, rows: 40 }, 'conversation.tool.command.compact.process.resize', '调整终端大小'],
  ] as const)('process 动作 %j 使用独立标题', (action, key, fallback) => {
    expect(projectCommandExecutionCompactStep({
      sourceToolName: 'process',
      uiKey: 'process',
      toolCallId: 'process-call-1',
      args: { process_handle: PROCESS_HANDLE, action },
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toEqual({ title: { key, fallback } });
  });

  it('error lifecycle 不解析非法命令参数，使用 owner 失败标题', () => {
    expect(projectCommandExecutionCompactStep({
      sourceToolName: 'shell',
      uiKey: 'shell',
      toolCallId: 'shell-call-error',
      args: { command: '' },
      result: { error: 'command rejected' },
      status: 'error',
      phase: 'error',
    })).toEqual({
      title: {
        key: 'conversation.tool.command.failed',
        fallback: '命令执行失败',
      },
    });
  });

  it('success lifecycle 严格接纳命令请求与结果', () => {
    expect(() => projectCommandExecutionCompactStep({
      sourceToolName: 'shell',
      uiKey: 'shell',
      toolCallId: 'shell-call-success',
      args: { command: 'pwd' },
      result: { data: { status: 'completed' } },
      status: 'success',
      phase: 'complete',
    })).toThrow();
  });
});
