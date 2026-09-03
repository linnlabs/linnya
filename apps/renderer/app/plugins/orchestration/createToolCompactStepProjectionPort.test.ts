import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { ToolCompactStepProjector } from '@linnya/plugin-host-contract/renderer/toolUi';
import { ToolCompactStepProjectionError } from '@/domains/conversation/ports/toolCompactStepProjectionPort';
import { createToolCompactStepProjectionPort } from './createToolCompactStepProjectionPort';

const TestComponent = defineComponent({});

describe('createToolCompactStepProjectionPort', () => {
  it('固定 alias 最终 key，并保留 wrapper 原始身份', () => {
    const compactStep: ToolCompactStepProjector = vi.fn((input) => ({
      title: {
        key: 'test.compact.read',
        fallback: '读取资源',
        params: { source: input.sourceToolName },
      },
    }));
    const resolve = vi.fn(() => ({
      uiKey: 'knowledge_read',
      config: { component: TestComponent, compactStep },
    }));
    const port = createToolCompactStepProjectionPort(resolve);

    expect(port.project({
      sourceToolName: 'resource_read',
      toolCallId: 'call-1',
      args: { uri: 'kb://documents/doc-1' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toEqual({
      title: {
        key: 'test.compact.read',
        fallback: '读取资源',
        params: { source: 'resource_read' },
      },
    });
    expect(compactStep).toHaveBeenCalledWith(expect.objectContaining({
      sourceToolName: 'resource_read',
      uiKey: 'knowledge_read',
      toolCallId: 'call-1',
    }));
  });

  it('未知工具或未声明 compactStep 时返回 undefined', () => {
    const unresolved = createToolCompactStepProjectionPort(() => null);
    const withoutProjector = createToolCompactStepProjectionPort(() => ({
      uiKey: 'plain_tool',
      config: { component: TestComponent },
    }));
    const request = {
      sourceToolName: 'plain_tool',
      toolCallId: 'call-2',
      args: {},
      result: undefined,
      status: 'loading' as const,
      phase: 'start' as const,
    };

    expect(unresolved.project(request)).toBeUndefined();
    expect(withoutProjector.project(request)).toBeUndefined();
  });

  it('projector 失败时包装 owner 身份，由 Subrun 高层统一记录诊断', () => {
    const error = new Error('invalid compact payload');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = createToolCompactStepProjectionPort(() => ({
      uiKey: 'shell',
      config: {
        component: TestComponent,
        compactStep: () => { throw error; },
      },
    }));

    let caught: unknown;
    try {
      port.project({
        sourceToolName: 'shell',
        toolCallId: 'call-shell',
        args: { command: 'cat secret.txt' },
        result: { secret: 'do-not-log' },
        status: 'success',
        phase: 'complete',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ToolCompactStepProjectionError);
    if (!(caught instanceof ToolCompactStepProjectionError)) {
      throw new Error('Expected ToolCompactStepProjectionError');
    }
    expect(caught.context).toEqual({
      sourceToolName: 'shell',
      uiKey: 'shell',
      toolCallId: 'call-shell',
      status: 'success',
      phase: 'complete',
    });
    expect(caught.cause).toBe(error);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
