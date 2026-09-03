import { describe, expect, it } from 'vitest';
import {
  ConversationImageDraftStageResponseSchema,
  ConversationNextRequest,
  ConversationUserInputCommittedEventSchema,
} from '../src/api-dtos';
import {
  CONVERSATION_IMAGE_MAX_ATTACHMENTS,
  ConversationAttachmentRefSchema,
  ConversationDraftAttachmentRefSchema,
} from '../src/conversation/attachment-ref';

const durableImage = {
  id: 'attachment-1',
  kind: 'image' as const,
  assetId: 'asset-1',
  mediaType: 'image/png' as const,
  byteLength: 1024,
  width: 640,
  height: 480,
  sha256: 'a'.repeat(64),
  fileName: 'diagram.png',
  label: '流程图',
};

describe('conversation attachment refs', () => {
  it('接受图片-only 上行消息，并保持草稿附件顺序', () => {
    const result = ConversationNextRequest.parse({
      conversation_id: 'conversation-1',
      new_events: [{
        type: 'user_input',
        timestamp: 1,
        content: '',
        source: 'user',
        attachments: [
          { draftId: 'draft-1', kind: 'image', fileName: 'first.png' },
          { draftId: 'draft-2', kind: 'image', fileName: 'second.webp' },
        ],
      }],
    });

    const userInput = result.new_events?.[0];
    expect(userInput?.type).toBe('user_input');
    if (userInput?.type !== 'user_input') {
      throw new Error('期望解析为 user_input');
    }
    expect(userInput.attachments?.map(attachment => attachment.draftId)).toEqual([
      'draft-1',
      'draft-2',
    ]);
  });

  it('上行草稿合同拒绝 durable 身份与路径字段', () => {
    expect(ConversationDraftAttachmentRefSchema.safeParse({
      draftId: 'draft-1',
      kind: 'image',
      assetId: 'asset-1',
    }).success).toBe(false);

    expect(ConversationDraftAttachmentRefSchema.safeParse({
      draftId: 'draft-1',
      kind: 'image',
      path: '/tmp/image.png',
    }).success).toBe(false);

    expect(ConversationDraftAttachmentRefSchema.safeParse({
      draftId: 'draft-1',
      kind: 'image',
      fileName: '/tmp/image.png',
    }).success).toBe(false);

    expect(ConversationNextRequest.safeParse({
      conversation_id: 'conversation-1',
      new_events: [{
        type: 'user_input',
        timestamp: 1,
        content: 'inspect',
        source: 'user',
        attachments: [durableImage],
      }],
    }).success).toBe(false);
  });

  it('下行 durable 合同接受真实图片事实并拒绝 draft 身份', () => {
    expect(ConversationAttachmentRefSchema.parse(durableImage)).toEqual(durableImage);
    expect(ConversationAttachmentRefSchema.safeParse({
      ...durableImage,
      draftId: 'draft-1',
    }).success).toBe(false);
  });

  it('拒绝不支持的格式、无效尺寸与无效 hash', () => {
    expect(ConversationAttachmentRefSchema.safeParse({
      ...durableImage,
      mediaType: 'image/gif',
    }).success).toBe(false);
    expect(ConversationAttachmentRefSchema.safeParse({
      ...durableImage,
      width: 0,
    }).success).toBe(false);
    expect(ConversationAttachmentRefSchema.safeParse({
      ...durableImage,
      sha256: 'ABC',
    }).success).toBe(false);
    expect(ConversationAttachmentRefSchema.safeParse({
      ...durableImage,
      byteLength: 10 * 1024 * 1024 + 1,
    }).success).toBe(false);
  });

  it('单条消息接受 100 个草稿附件，并明确拒绝第 101 个', () => {
    const createRequest = (count: number) => ({
      conversation_id: 'conversation-1',
      new_events: [{
        type: 'user_input',
        timestamp: 1,
        content: '',
        source: 'user',
        attachments: Array.from({ length: count }, (_, index) => ({
          draftId: `draft-${index}`,
          kind: 'image',
        })),
      }],
    });

    expect(CONVERSATION_IMAGE_MAX_ATTACHMENTS).toBe(100);
    expect(ConversationNextRequest.safeParse(createRequest(100)).success).toBe(true);
    expect(ConversationNextRequest.safeParse(createRequest(101)).success).toBe(false);
  });

  it('保持既有纯文本请求兼容', () => {
    expect(ConversationNextRequest.safeParse({
      conversation_id: 'conversation-1',
      new_events: [{
        type: 'user_input',
        timestamp: 1,
        content: 'hello',
        source: 'user',
      }],
    }).success).toBe(true);
  });

  it('edit selection 只接受目标附件 ID或严格 draft ref，并保持声明顺序', () => {
    const result = ConversationNextRequest.parse({
      conversation_id: 'conversation-1',
      new_events: [{
        type: 'user_input',
        id: 'message-1',
        timestamp: 2,
        content: 'edited',
        source: 'user',
        attachment_selection: {
          mode: 'replace',
          items: [
            { source: 'existing', attachmentId: 'attachment-1' },
            { source: 'draft', draft: { draftId: 'draft-2', kind: 'image', fileName: 'new.png' } },
          ],
        },
      }],
      options: {
        truncateFromMessageId: 'message-1',
        truncateReason: 'edit',
      },
    });
    const event = result.new_events?.[0];
    expect(event?.type === 'user_input' ? event.attachment_selection : undefined).toEqual({
      mode: 'replace',
      items: [
        { source: 'existing', attachmentId: 'attachment-1' },
        { source: 'draft', draft: { draftId: 'draft-2', kind: 'image', fileName: 'new.png' } },
      ],
    });

    expect(ConversationNextRequest.safeParse({
      conversation_id: 'conversation-1',
      new_events: [{
        type: 'user_input',
        timestamp: 2,
        content: 'edited',
        source: 'user',
        attachment_selection: {
          mode: 'replace',
          items: [{ source: 'existing', attachmentId: 'attachment-1', assetId: 'asset-1' }],
        },
      }],
      options: { truncateFromMessageId: 'message-1', truncateReason: 'edit' },
    }).success).toBe(false);
  });

  it('拒绝普通发送携带 selection、双附件通道与 regenerate replace', () => {
    const baseEvent = {
      type: 'user_input' as const,
      id: 'message-1',
      timestamp: 2,
      content: 'edited',
      source: 'user' as const,
    };
    expect(ConversationNextRequest.safeParse({
      conversation_id: 'conversation-1',
      new_events: [{ ...baseEvent, attachment_selection: { mode: 'preserve' } }],
    }).success).toBe(false);
    expect(ConversationNextRequest.safeParse({
      conversation_id: 'conversation-1',
      new_events: [{
        ...baseEvent,
        attachments: [{ draftId: 'draft-1', kind: 'image' }],
        attachment_selection: { mode: 'preserve' },
      }],
      options: { truncateFromMessageId: 'message-1', truncateReason: 'edit' },
    }).success).toBe(false);
    expect(ConversationNextRequest.safeParse({
      conversation_id: 'conversation-1',
      new_events: [{
        ...baseEvent,
        attachment_selection: { mode: 'replace', items: [] },
      }],
      options: { truncateFromMessageId: 'message-1', truncateReason: 'regenerate' },
    }).success).toBe(false);
    expect(ConversationNextRequest.safeParse({
      conversation_id: 'conversation-1',
      new_events: [baseEvent],
      options: { truncateFromMessageId: 'message-1', truncateReason: 'edit' },
    }).success).toBe(false);
  });

  it('stage response 与 commit ack只接受安全方向字段', () => {
    const stageResponse = {
      draft: { draftId: 'draft-1', kind: 'image' as const, fileName: 'image.png' },
      mediaType: 'image/png' as const,
      byteLength: 1024,
      width: 640,
      height: 480,
      sha256: 'b'.repeat(64),
    };
    expect(ConversationImageDraftStageResponseSchema.safeParse(stageResponse).success).toBe(true);
    expect(ConversationImageDraftStageResponseSchema.safeParse({
      ...stageResponse,
      localPath: '/tmp/image.png',
    }).success).toBe(false);

    const ack = {
      id: 'message-1',
      type: 'user_input_committed' as const,
      timestamp: 3,
      conversation_id: 'conversation-1',
      turn_id: 'turn-2',
      operation: 'replace' as const,
      replaced_from_message_id: 'message-1',
      content: 'edited',
      raw_content: 'edited',
      attachments: [durableImage],
    };
    expect(ConversationUserInputCommittedEventSchema.safeParse(ack).success).toBe(true);
    expect(ConversationUserInputCommittedEventSchema.safeParse({
      ...ack,
      raw_content: undefined,
    }).success).toBe(false);
    expect(ConversationUserInputCommittedEventSchema.safeParse({
      ...ack,
      replaced_from_message_id: 'other-message',
    }).success).toBe(false);
    expect(ConversationUserInputCommittedEventSchema.safeParse({
      ...ack,
      attachments: [{ draftId: 'draft-1', kind: 'image' }],
    }).success).toBe(false);
    expect(ConversationUserInputCommittedEventSchema.safeParse({
      ...ack,
      absolutePath: '/tmp/image.png',
    }).success).toBe(false);
  });
});
