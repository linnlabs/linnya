import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PromptKeys } from '@app/schemas';
import { HistoryBuilder } from '../flow.history-builder.service';
import { createUserInputEvent, type RuntimeEvent, type RuntimeResourceRef } from '@linnlabs/linnkit/contracts';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

describe('HistoryBuilder user input context', () => {
  const attachment: RuntimeResourceRef = {
    id: 'attachment-1',
    kind: 'image',
    resourceId: 'asset-1',
    mediaType: 'image/png',
    byteLength: 1024,
    width: 640,
    height: 480,
    sha256: 'a'.repeat(64),
  };
  beforeEach(() => {
    setPluginRuntimeStateForTests({
      enabledPluginIds: ['platform'],
    });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
  });

  it('wraps agent query with local_time and user_request', () => {
    const timestamp = new Date(2026, 5, 18, 9, 7, 5).getTime();

    const request = HistoryBuilder.buildForAgent(
      'conv_agent_time',
      [createUserInputEvent(
        'user-event-time',
        'conv_agent_time',
        'turn-agent-time',
        '原始请求',
        { timestamp },
      )],
      [],
      {
        promptKey: PromptKeys.DEFAULT,
      },
    );

    expect(request?.query).toBe([
      '<local_time>2026-06-18 09:07:05</local_time>',
      '<user_request>\n原始请求\n</user_request>',
    ].join('\n\n'));
    expect(request?.currentUserEventId).toBe('user-event-time');
    expect(request?.maxSteps).toBe(800);
  });

  it('uses agent query wrapping for single-turn compatible requests', () => {
    const timestamp = new Date(2026, 5, 18, 9, 7, 5).getTime();

    const request = HistoryBuilder.buildForAgent(
      'conv_single_turn_time',
      [createUserInputEvent(
        'user-event-single-turn',
        'conv_single_turn_time',
        'turn-single-time',
        '原始请求',
        { timestamp },
      )],
      [],
      {
        promptKey: PromptKeys.DEFAULT,
      },
    );

    expect(request?.query).toBe([
      '<local_time>2026-06-18 09:07:05</local_time>',
      '<user_request>\n原始请求\n</user_request>',
    ].join('\n\n'));
  });

  it('从 user_input metadata 保留结构化多引用到 Agent 请求', () => {
    const request = HistoryBuilder.buildForAgent(
      'conv_user_quote_items',
      [createUserInputEvent(
        'user-event-quotes',
        'conv_user_quote_items',
        'turn-user-quotes',
        '比较这些引用',
        { timestamp: 1, metadata: {
          user_quote: {
            items: [
              {
                quote_id: 'reference-11111111111111111111111111111111',
                plugin_id: 'platform',
                kind: 'text-selection',
                text: 'first',
                source: { doc_id: 'doc-1' },
              },
              {
                quote_id: 'reference-22222222222222222222222222222222',
                plugin_id: 'slides',
                kind: 'slides-source-selection',
                text: 'second',
                metadata: { presentationId: 'deck-1' },
              },
            ],
          },
        } },
      )],
      [],
      { promptKey: PromptKeys.DEFAULT },
    );

    expect(request?.user_quote).toEqual({
      items: [
        {
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'first',
          source: { doc_id: 'doc-1' },
        },
        {
          quote_id: 'reference-22222222222222222222222222222222',
          plugin_id: 'slides',
          kind: 'slides-source-selection',
          text: 'second',
          metadata: { presentationId: 'deck-1' },
        },
      ],
    });
  });

  it('拒绝丢失引用身份的 user_quote，而不是静默删除引用', () => {
    const event = createUserInputEvent(
      'user-event-invalid-quote',
      'conv_invalid_user_quote',
      'turn-invalid-user-quote',
      '比较这个引用',
      { timestamp: 1, metadata: {
        user_quote: {
          items: [{
            plugin_id: 'platform',
            kind: 'text-selection',
            text: 'missing quote identity',
          }],
        },
      } },
    );

    expect(() => HistoryBuilder.buildForAgent(
      'conv_invalid_user_quote',
      [event],
      [],
      { promptKey: PromptKeys.DEFAULT },
    )).toThrow();
  });

  it('从同一个最后 user event 聚合 ID、文本、附件和 metadata', () => {
    const history: RuntimeEvent[] = [
      {
        type: 'user_input',
        id: 'old-user',
        conversation_id: 'conv_durable_attachment',
        turn_id: 'turn-old',
        timestamp: 1,
        version: 1,
        content: '重复问题',
        source: 'user',
      },
      {
        type: 'user_input',
        id: 'current-user',
        conversation_id: 'conv_durable_attachment',
        turn_id: 'turn-current',
        timestamp: 2,
        version: 1,
        content: '重复问题',
        source: 'user',
        attachments: [attachment],
        metadata: {
          user_quote: {
            items: [{
              quote_id: 'reference-11111111111111111111111111111111',
              plugin_id: 'platform',
              kind: 'text-selection',
              text: 'current quote',
            }],
          },
        },
      },
    ];

    const request = HistoryBuilder.buildForAgent(
      'conv_durable_attachment',
      [],
      history,
      { promptKey: PromptKeys.DEFAULT },
    );

    expect(request?.currentUserEventId).toBe('current-user');
    expect(request?.currentUserAttachments).toEqual([attachment]);
    expect(request?.query).toContain('重复问题');
    expect(request?.user_quote?.items[0]?.text).toBe('current quote');
  });

});
