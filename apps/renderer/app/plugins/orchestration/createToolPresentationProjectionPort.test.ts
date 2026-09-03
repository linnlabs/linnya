import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { ConversationUiMessageSchema } from '@app/schemas';
import type { ToolPresentationProjector } from '@linnya/plugin-host-contract/renderer/toolUi';
import { mapUiMessageDtoToConversationMessage } from '@/domains/conversation/message-window/functions/mapUiMessageDto';
import { registerToolPresentationProjectionPort } from '@/domains/conversation/ports/toolPresentationProjectionPort';
import { createToolPresentationProjectionPort } from './createToolPresentationProjectionPort';

const TestComponent = defineComponent({});

describe('createToolPresentationProjectionPort', () => {
  it('固定 alias 最终 key，并把 wrapper 原始身份交给同一个 projector', () => {
    const presentation: ToolPresentationProjector = vi.fn((input) => ({
      data: {
        sourceToolName: input.sourceToolName,
        uri: input.args,
      },
      title: {
        text: {
          key: 'conversation.tool.resourceRead.title',
          fallback: 'Read resource',
        },
      },
    }));
    const resolve = vi.fn(() => ({
      uiKey: 'routed_read',
      config: {
        component: TestComponent,
        presentation,
      },
    }));
    const port = createToolPresentationProjectionPort(resolve);

    expect(port.project({
      sourceToolName: 'resource_read',
      args: { uri: 'domain://items/item-1' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toEqual({
      uiKey: 'routed_read',
      status: 'loading',
      phase: 'start',
      data: {
        sourceToolName: 'resource_read',
        uri: { uri: 'domain://items/item-1' },
      },
      title: {
        text: {
          key: 'conversation.tool.resourceRead.title',
          fallback: 'Read resource',
        },
      },
    });
    expect(presentation).toHaveBeenCalledWith(expect.objectContaining({
      sourceToolName: 'resource_read',
      uiKey: 'routed_read',
    }));
  });

  it('没有专用 projector 时不制造空 presentation', () => {
    const port = createToolPresentationProjectionPort(() => ({
      uiKey: 'plain_tool',
      config: { component: TestComponent },
    }));

    expect(port.project({
      sourceToolName: 'plain_tool',
      args: {},
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toBeUndefined();
  });

  it('projector 失败时记录脱敏诊断并保持原错误', () => {
    const error = new Error('invalid command result');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = createToolPresentationProjectionPort(() => ({
      uiKey: 'shell',
      config: {
        component: TestComponent,
        presentation: () => { throw error; },
      },
    }));

    expect(() => port.project({
      sourceToolName: 'shell',
      args: { command: 'cat secret.txt', inode: '' },
      result: { secret: 'do-not-log' },
      status: 'success',
      phase: 'complete',
    })).toThrow(error);

    expect(consoleError).toHaveBeenCalledWith(
      '[ToolPresentationProjection] projector failed',
      expect.objectContaining({
        sourceToolName: 'shell',
        uiKey: 'shell',
        inode: 'empty',
        argKeys: ['command', 'inode'],
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('do-not-log');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('cat secret.txt');
    consoleError.mockRestore();
  });

  it('从持久化工具结果恢复已注册 presentation，不依赖执行期临时字段', () => {
    const port = createToolPresentationProjectionPort(() => ({
      uiKey: 'document_inspect',
      config: {
        component: TestComponent,
        presentation: input => ({ data: input.result }),
      },
    }));
    const unregister = registerToolPresentationProjectionPort(port);

    try {
      const dto = ConversationUiMessageSchema.parse({
        message_id: 'tool:run-current:call-inspect-current',
        conversation_id: 'conv-current',
        turn_id: 'turn-current',
        run_id: 'run-current',
        role: 'assistant',
        message_type: 'tool_calls',
        sort_seq: 1,
        timestamp: 1,
        content: 'Slides inspection\n1 个问题',
        payload: {
          tool_call_id: 'call-inspect-current',
          tool_name: 'document_inspect',
          status: 'success',
          phase: 'complete',
          args: { locator: 'workspace:/经营复盘.slides' },
          data: {
            artifact: {
              presentationId: 'ppt-current',
              versionId: 'version-current',
              slideCount: 1,
            },
            document: { title: '经营复盘', locator: 'workspace:/经营复盘.slides' },
            selection: {
              requestedSlideNumbers: [1],
              shownSlideNumbers: [1],
              truncated: false,
            },
            pages: [
              { slideNumber: 1, layoutKey: 'content', elementCount: 8, editableTargetCount: 6 },
            ],
            buildStatus: { state: 'ready' },
            findingSummary: {
              rawFindingCount: 1,
              uniqueFindingCount: 1,
              rootGroupCount: 1,
              p0Count: 1,
              p1Count: 0,
              p2Count: 0,
            },
          },
          started_at: 1,
          completed_at: 2,
        },
        merge_key: null,
        presentation: null,
      });

      const message = mapUiMessageDtoToConversationMessage(dto);
      expect(message.type).toBe('tool_calls');
      if (message.type !== 'tool_calls') throw new Error('Expected tool_calls message');
      expect(message.toolPresentation).toMatchObject({
        uiKey: 'document_inspect',
        status: 'success',
        phase: 'complete',
        data: {
          data: {
            artifact: {
              presentationId: 'ppt-current',
              versionId: 'version-current',
              slideCount: 1,
            },
            document: { title: '经营复盘', locator: 'workspace:/经营复盘.slides' },
          },
          observation: 'Slides inspection\n1 个问题',
        },
      });
    } finally {
      unregister();
    }
  });
});
