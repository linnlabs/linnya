import { describe, expect, it } from 'vitest';

import type { AiMessage, RuntimeResourceRef } from '../../../../contracts';
import { createFenceRegistry } from '../../fences';
import { CurrentTurnMessageAssembler } from '../currentTurnMessageAssembler';

const registry = createFenceRegistry([
  {
    kind: 'document-context',
    llmRole: 'user',
    placement: 'before-current-user',
    lifetime: 'turn-only',
    formatter: content => `<document_context>\n${content}\n</document_context>`,
  },
  {
    kind: 'user-quote',
    llmRole: 'user',
    placement: 'before-current-user',
    lifetime: 'turn-only',
    formatter: content => `<user_quote>\n${content}\n</user_quote>`,
  },
  {
    kind: 'follow-up-context',
    llmRole: 'user',
    placement: 'after-current-user',
    lifetime: 'turn-only',
    formatter: content => `<follow_up_context>\n${content}\n</follow_up_context>`,
  },
  {
    kind: 'additional-context',
    llmRole: 'system',
    placement: 'after-system',
    lifetime: 'persisted',
    formatter: content => `<additional_context>\n${content}\n</additional_context>`,
  },
]);

function message(
  id: string,
  role: AiMessage['role'],
  type: AiMessage['type'],
  content: string,
  metadata?: AiMessage['metadata'],
): AiMessage {
  return { id, role, type, content, timestamp: 1, ...(metadata ? { metadata } : {}) } as AiMessage;
}

describe('CurrentTurnMessageAssembler', () => {
  it('assembles adjacent system-side fences into the system prompt upstream', async () => {
    const messages: AiMessage[] = [
      message('system', 'system', 'system_prompt', 'System prompt'),
      message('ctx', 'system', 'context_injection', 'Stable context', {
        fenceKind: 'additional-context',
      }),
      message('user', 'user', 'user_input', '继续'),
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages.map(item => item.id)).toEqual(['system', 'user']);
    expect(result.messages[0].content).toBe([
      'System prompt',
      '<additional_context>\nStable context\n</additional_context>',
    ].join('\n\n'));
    expect(result.messages[0].metadata?.assembledFenceKinds).toEqual(['additional-context']);
  });

  it('assembles adjacent current-turn user fences into the current user_input', async () => {
    const messages: AiMessage[] = [
      message('system', 'system', 'system_prompt', 'system'),
      message('doc', 'user', 'context_injection', 'selected source', {
        fenceKind: 'document-context',
      }),
      message('quote', 'user', 'context_injection', 'selected element', {
        fenceKind: 'user-quote',
      }),
      message('user', 'user', 'user_input', '改成圆角矩形'),
      message('after', 'user', 'context_injection', 'after note', {
        fenceKind: 'follow-up-context',
      }),
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages.map(item => item.id)).toEqual(['system', 'user']);
    expect(result.messages[1].content).toBe([
      '<document_context>\nselected source\n</document_context>',
      '<user_quote>\nselected element\n</user_quote>',
      '<user_request>\n改成圆角矩形\n</user_request>',
      '<follow_up_context>\nafter note\n</follow_up_context>',
    ].join('\n\n'));
    expect(result.messages[1].metadata?.assembledFenceKinds).toEqual([
      'document-context',
      'user-quote',
      'follow-up-context',
    ]);
  });

  it('组装当前轮 fence 时保持 user_input 附件身份和顺序', async () => {
    const attachments: RuntimeResourceRef[] = [
      {
        id: 'attachment-1',
        kind: 'image',
        resourceId: 'resource-1',
        mediaType: 'image/png',
        byteLength: 1024,
        width: 640,
        height: 480,
        sha256: 'a'.repeat(64),
      },
      {
        id: 'attachment-2',
        kind: 'image',
        resourceId: 'resource-2',
        mediaType: 'image/webp',
        byteLength: 2048,
        width: 800,
        height: 600,
        sha256: 'b'.repeat(64),
      },
    ];
    const userMessage: AiMessage = {
      id: 'user',
      role: 'user',
      type: 'user_input',
      content: '',
      timestamp: 1,
      attachments,
    };
    const messages: AiMessage[] = [
      message('doc', 'user', 'context_injection', 'selected source', {
        fenceKind: 'document-context',
      }),
      userMessage,
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});
    const assembledUser = result.messages.find(item => item.id === 'user');

    expect(assembledUser && 'attachments' in assembledUser
      ? assembledUser.attachments?.map(attachment => attachment.id)
      : undefined).toEqual(['attachment-1', 'attachment-2']);
  });

  it('does not assemble non-adjacent system-side fences', async () => {
    const messages: AiMessage[] = [
      message('system', 'system', 'system_prompt', 'system'),
      message('assistant', 'assistant', 'final_answer', 'interruption'),
      message('ctx', 'system', 'context_injection', 'stable context', {
        fenceKind: 'additional-context',
      }),
      message('user', 'user', 'user_input', '继续'),
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages.map(item => item.id)).toEqual(['system', 'assistant', 'ctx', 'user']);
    expect(result.appliedStrategies).toEqual([]);
  });

  it('does not add user fence XML when no user-side fence is injected', async () => {
    const messages: AiMessage[] = [
      message('system', 'system', 'system_prompt', 'system'),
      message('user', 'user', 'user_input', '直接请求'),
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages).toEqual(messages);
    expect(result.messages[1].content).toBe('直接请求');
    expect(result.messages[1].content).not.toContain('<document_context>');
    expect(result.messages[1].content).not.toContain('<user_quote>');
    expect(result.messages[1].content).not.toContain('<user_request>');
  });

  it('uses only actually injected before-current-user fence XML before user_request', async () => {
    const messages: AiMessage[] = [
      message('doc', 'user', 'context_injection', '片段内容', {
        fenceKind: 'document-context',
      }),
      message('user', 'user', 'user_input', '用户原始请求'),
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe([
      '<document_context>\n片段内容\n</document_context>',
      '<user_request>\n用户原始请求\n</user_request>',
    ].join('\n\n'));
    expect(result.messages[0].content).not.toContain('<user_quote>');
    expect(result.messages[0].content).not.toContain('<follow_up_context>');
  });

  it('does not nest user_request when the host already wrapped model-facing user content', async () => {
    const messages: AiMessage[] = [
      message('doc', 'user', 'context_injection', '片段内容', {
        fenceKind: 'document-context',
      }),
      message('user', 'user', 'user_input', [
        '<local_time>2026-06-18 09:07:05</local_time>',
        '<user_request>\n用户原始请求\n</user_request>',
      ].join('\n\n')),
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe([
      '<document_context>\n片段内容\n</document_context>',
      '<local_time>2026-06-18 09:07:05</local_time>',
      '<user_request>\n用户原始请求\n</user_request>',
    ].join('\n\n'));
    expect(result.messages[0].content.match(/<user_request>/g)).toHaveLength(1);
  });

  it('does not consume historical non-adjacent turn-only fences', async () => {
    const messages: AiMessage[] = [
      message('old-doc', 'user', 'context_injection', 'old selected source', {
        fenceKind: 'document-context',
      }),
      message('old-user', 'user', 'user_input', '旧问题'),
      message('assistant', 'assistant', 'final_answer', '旧回答'),
      message('user', 'user', 'user_input', '新问题'),
    ];

    const result = await new CurrentTurnMessageAssembler({ fenceRegistry: registry }).process(messages, {});

    expect(result.messages).toEqual(messages);
    expect(result.appliedStrategies).toEqual([]);
  });
});
