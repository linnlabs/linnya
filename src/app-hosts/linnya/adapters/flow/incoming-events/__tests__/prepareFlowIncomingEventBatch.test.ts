import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationNextRequest } from '@app/schemas';
import type {
  CommittedConversationImageFile,
  ConversationImageDraft,
} from 'src/features/conversation/attachments/features/image-ingress';
import type { WorkspaceAssetIdentityPort } from 'src/features/workspace/assets/definitions/workspaceAssetIdentity';
import { HistoryBuilder } from '../../flow.history-builder.service';
import { FlowIncomingEventPreparer } from '../orchestration/prepareFlowIncomingEventBatch';
import type { FlowImageDraftCommitPort } from '../definitions/flowImageDraftCommitPort';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';

function committedImage(params: {
  readonly draftId: string;
  readonly shaCharacter: string;
  readonly mediaType?: 'image/png' | 'image/webp';
  readonly fileName: string;
}): CommittedConversationImageFile {
  const sha256 = params.shaCharacter.repeat(64);
  const extension = params.mediaType === 'image/webp' ? 'webp' : 'png';
  return {
    draftId: params.draftId,
    kind: 'image',
    mediaType: params.mediaType ?? 'image/png',
    byteLength: 128,
    width: 16,
    height: 8,
    sha256,
    fileName: params.fileName,
    uri: `/Resources/Attachments/${sha256.slice(0, 2)}/${sha256}.${extension}`,
    localPath: `/managed/${sha256}.${extension}`,
  };
}

class ImageIngressFake implements FlowImageDraftCommitPort {
  readonly committedByDraftId = new Map<string, CommittedConversationImageFile>();
  readonly resolvedBatches: string[][] = [];
  readonly releasedDraftIds: string[] = [];

  resolveDraftBatch(draftIds: readonly string[]): readonly ConversationImageDraft[] {
    this.resolvedBatches.push([...draftIds]);
    return draftIds.map(draftId => {
      const draft = this.committedByDraftId.get(draftId);
      if (!draft) throw new Error(`missing draft ${draftId}`);
      return draft;
    });
  }

  async commitDraftFile(draftId: string): Promise<CommittedConversationImageFile> {
    const committed = this.committedByDraftId.get(draftId);
    if (!committed) throw new Error(`missing draft ${draftId}`);
    return committed;
  }

  async releaseDraft(draftId: string): Promise<void> {
    this.releasedDraftIds.push(draftId);
  }
}

class AssetIdentityFake implements WorkspaceAssetIdentityPort {
  private readonly idsByUri = new Map<string, string>();

  resolveCanonicalAssetId(uri: string): string {
    const existing = this.idsByUri.get(uri);
    if (existing) return existing;
    const id = `asset-${this.idsByUri.size + 1}`;
    this.idsByUri.set(uri, id);
    return id;
  }
}

describe('FlowIncomingEventPreparer', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
  });

  it('一次构造图片-only runtime event、asset commits 和 Agent 当前轮附件，并保持顺序', async () => {
    const ingress = new ImageIngressFake();
    ingress.committedByDraftId.set('draft-first', committedImage({
      draftId: 'draft-first',
      shaCharacter: 'a',
      fileName: 'first.png',
    }));
    ingress.committedByDraftId.set('draft-second', committedImage({
      draftId: 'draft-second',
      shaCharacter: 'b',
      mediaType: 'image/webp',
      fileName: 'second.webp',
    }));
    const attachmentIds = ['attachment-first', 'attachment-second'];
    const preparer = new FlowIncomingEventPreparer(
      { kind: 'enabled', imageIngress: ingress, assetIdentity: new AssetIdentityFake() },
      () => attachmentIds.shift() ?? 'attachment-extra',
    );
    const request: ConversationNextRequest = {
      conversation_id: 'conv-image-only',
      new_events: [{
        type: 'user_input',
        id: 'event-image-only',
        content: '',
        timestamp: 1000,
        source: 'user',
        attachments: [
          { draftId: 'draft-second', kind: 'image', label: 'second label' },
          { draftId: 'draft-first', kind: 'image' },
        ],
      }],
      options: { promptKey: 'default' },
    };

    const batch = await preparer.prepare({
      request,
      conversationId: 'conv-image-only',
      turnId: 'turn-image-only',
      historyBeforeTruncate: [],
      shouldPersist: true,
    });
    const userEvent = batch.events[0];
    expect(userEvent).toMatchObject({
      type: 'user_input',
      id: 'event-image-only',
      turn_id: 'turn-image-only',
      raw_content: '',
    });
    expect(userEvent?.type === 'user_input'
      ? userEvent.attachments?.map(item => ({
          id: item.id,
          resourceId: item.resourceId,
          fileName: item.fileName,
          label: item.label,
        }))
      : []).toEqual([
      {
        id: 'attachment-first',
        resourceId: 'asset-1',
        fileName: 'second.webp',
        label: 'second label',
      },
      {
        id: 'attachment-second',
        resourceId: 'asset-2',
        fileName: 'first.png',
        label: undefined,
      },
    ]);
    expect(batch.assetCommitsByEventId.get('event-image-only')?.map(item => item.assetId))
      .toEqual(['asset-1', 'asset-2']);
    expect(batch.committedDraftIds).toEqual(['draft-second', 'draft-first']);
    expect(ingress.releasedDraftIds).toEqual([]);

    const agentRequest = HistoryBuilder.buildForAgent(
      'conv-image-only',
      [...batch.events],
      [],
      { promptKey: 'default' },
    );
    expect(agentRequest?.currentUserEventId).toBe(userEvent?.id);
    expect(agentRequest?.currentUserAttachments).toEqual(
      userEvent?.type === 'user_input' ? userEvent.attachments : undefined,
    );
    expect(agentRequest?.query).toContain('<user_request>\n\n</user_request>');

    await preparer.releaseCommittedDrafts(batch);
    expect(ingress.releasedDraftIds).toEqual(['draft-second', 'draft-first']);
  });

  it('同内容 draft 复用 canonical asset，只提交一份 asset 登记事实', async () => {
    const ingress = new ImageIngressFake();
    const sameContent = committedImage({
      draftId: 'draft-a',
      shaCharacter: 'c',
      fileName: 'same.png',
    });
    ingress.committedByDraftId.set('draft-a', sameContent);
    ingress.committedByDraftId.set('draft-b', { ...sameContent, draftId: 'draft-b' });
    const preparer = new FlowIncomingEventPreparer(
      { kind: 'enabled', imageIngress: ingress, assetIdentity: new AssetIdentityFake() },
    );

    const batch = await preparer.prepare({
      request: {
        conversation_id: 'conv-same-image',
        new_events: [{
          type: 'user_input',
          id: 'event-same-image',
          content: 'compare',
          timestamp: 1000,
          source: 'user',
          attachments: [
            { draftId: 'draft-a', kind: 'image' },
            { draftId: 'draft-b', kind: 'image' },
          ],
        }],
      },
      conversationId: 'conv-same-image',
      turnId: 'turn-same-image',
      historyBeforeTruncate: [],
      shouldPersist: true,
    });

    const event = batch.events[0];
    expect(event?.type === 'user_input'
      ? event.attachments?.map(item => item.resourceId)
      : []).toEqual(['asset-1', 'asset-1']);
    expect(batch.assetCommitsByEventId.get('event-same-image')).toHaveLength(1);
  });

  it('DB 写入失败时不释放 draft，成功后才释放', async () => {
    const ingress = new ImageIngressFake();
    ingress.committedByDraftId.set('draft-db-failure', committedImage({
      draftId: 'draft-db-failure',
      shaCharacter: 'd',
      fileName: 'failure.png',
    }));
    const preparer = new FlowIncomingEventPreparer({
      kind: 'enabled',
      imageIngress: ingress,
      assetIdentity: new AssetIdentityFake(),
    });
    const batch = await preparer.prepare({
      request: {
        new_events: [{
          type: 'user_input',
          id: 'event-db-failure',
          content: 'persist',
          timestamp: 1000,
          source: 'user',
          attachments: [{ draftId: 'draft-db-failure', kind: 'image' }],
        }],
      },
      conversationId: 'conv-db-failure',
      turnId: 'turn-db-failure',
      historyBeforeTruncate: [],
      shouldPersist: true,
    });

    await expect(preparer.persistAndRelease(batch, async () => {
      throw new Error('database write failed');
    })).rejects.toThrow('database write failed');
    expect(ingress.releasedDraftIds).toEqual([]);

    await preparer.persistAndRelease(batch, async () => {});
    expect(ingress.releasedDraftIds).toEqual(['draft-db-failure']);
  });

  it('edit 按 selection 顺序复用目标附件并插入新 draft', async () => {
    const ingress = new ImageIngressFake();
    ingress.committedByDraftId.set('draft-new', committedImage({
      draftId: 'draft-new',
      shaCharacter: 'f',
      fileName: 'new.png',
    }));
    const firstExisting = {
      id: 'attachment-existing-1',
      kind: 'image' as const,
      resourceId: 'asset-existing-1',
      mediaType: 'image/png' as const,
      byteLength: 64,
      width: 8,
      height: 8,
      sha256: '1'.repeat(64),
    };
    const secondExisting = {
      ...firstExisting,
      id: 'attachment-existing-2',
      resourceId: 'asset-existing-2',
      sha256: '2'.repeat(64),
    };
    const preparer = new FlowIncomingEventPreparer(
      { kind: 'enabled', imageIngress: ingress, assetIdentity: new AssetIdentityFake() },
      () => 'attachment-new',
    );
    const batch = await preparer.prepare({
      request: {
        conversation_id: 'conv-edit-selection',
        new_events: [{
          type: 'user_input',
          id: 'message-edit-selection',
          content: 'edited',
          timestamp: 2000,
          source: 'user',
          attachment_selection: {
            mode: 'replace',
            items: [
              { source: 'existing', attachmentId: secondExisting.id },
              { source: 'draft', draft: { draftId: 'draft-new', kind: 'image' } },
              { source: 'existing', attachmentId: firstExisting.id },
            ],
          },
        }],
        options: {
          truncateFromMessageId: 'message-edit-selection',
          truncateReason: 'edit',
        },
      },
      conversationId: 'conv-edit-selection',
      turnId: 'turn-edit-selection',
      historyBeforeTruncate: [{
        type: 'user_input',
        id: 'message-edit-selection',
        conversation_id: 'conv-edit-selection',
        turn_id: 'turn-original',
        timestamp: 1000,
        version: 1,
        content: 'original',
        source: 'user',
        attachments: [firstExisting, secondExisting],
      }],
      shouldPersist: true,
    });

    const replacement = batch.events[0];
    expect(replacement?.type === 'user_input'
      ? replacement.attachments?.map(item => item.id)
      : []).toEqual(['attachment-existing-2', 'attachment-new', 'attachment-existing-1']);
    expect(batch.assetCommitsByEventId.get('message-edit-selection')).toHaveLength(1);
    expect(batch.committedDraftIds).toEqual(['draft-new']);
  });

  it('edit 在提交 draft 前拒绝不属于目标消息的 existing attachment', async () => {
    const ingress = new ImageIngressFake();
    ingress.committedByDraftId.set('draft-must-not-commit', committedImage({
      draftId: 'draft-must-not-commit',
      shaCharacter: '9',
      fileName: 'blocked.png',
    }));
    const preparer = new FlowIncomingEventPreparer({
      kind: 'enabled',
      imageIngress: ingress,
      assetIdentity: new AssetIdentityFake(),
    });

    await expect(preparer.prepare({
      request: {
        conversation_id: 'conv-cross-message',
        new_events: [{
          type: 'user_input',
          id: 'message-target',
          content: 'edited',
          timestamp: 2000,
          source: 'user',
          attachment_selection: {
            mode: 'replace',
            items: [
              { source: 'draft', draft: { draftId: 'draft-must-not-commit', kind: 'image' } },
              { source: 'existing', attachmentId: 'attachment-from-another-message' },
            ],
          },
        }],
        options: { truncateFromMessageId: 'message-target', truncateReason: 'edit' },
      },
      conversationId: 'conv-cross-message',
      turnId: 'turn-cross-message',
      historyBeforeTruncate: [{
        type: 'user_input',
        id: 'message-target',
        conversation_id: 'conv-cross-message',
        turn_id: 'turn-original',
        timestamp: 1000,
        version: 1,
        content: 'original',
        source: 'user',
        attachments: [],
      }],
      shouldPersist: true,
    })).rejects.toThrow('不属于 replacement target');
    expect(ingress.resolvedBatches).toEqual([]);
  });

  it('拒绝空文本和空 selection 覆盖原消息', async () => {
    const preparer = new FlowIncomingEventPreparer({ kind: 'disabled' });
    await expect(preparer.prepare({
      request: {
        conversation_id: 'conv-empty-edit',
        new_events: [{
          type: 'user_input',
          id: 'message-empty-edit',
          content: '',
          timestamp: 2000,
          source: 'user',
          attachment_selection: { mode: 'replace', items: [] },
        }],
        options: { truncateFromMessageId: 'message-empty-edit', truncateReason: 'edit' },
      },
      conversationId: 'conv-empty-edit',
      turnId: 'turn-empty-edit',
      historyBeforeTruncate: [{
        type: 'user_input',
        id: 'message-empty-edit',
        conversation_id: 'conv-empty-edit',
        turn_id: 'turn-original',
        timestamp: 1000,
        version: 1,
        content: 'original',
        source: 'user',
      }],
      shouldPersist: true,
    })).rejects.toThrow('不能同时缺少文本和附件');
  });
});
