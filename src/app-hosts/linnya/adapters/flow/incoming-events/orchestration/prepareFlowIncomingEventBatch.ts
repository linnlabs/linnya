import { randomUUID } from 'node:crypto';
import type {
  ConversationAttachmentSelection,
  ConversationDraftAttachmentRef,
  ConversationNextRequest,
} from '@app/schemas';
import type { RuntimeEvent, RuntimeResourceRef } from 'linnkit/contracts';
import type { WorkspaceAssetIdentityPort } from 'src/features/workspace/assets/definitions/workspaceAssetIdentity';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';
import type { FlowIncomingEventBatch } from '../definitions/flowIncomingEventBatch';
import type { FlowImageDraftCommitPort } from '../definitions/flowImageDraftCommitPort';
import {
  buildFlowIncomingEventBatch,
  type ResolvedFlowUserAttachments,
} from '../functions/buildFlowIncomingEventBatch';

export type FlowIncomingAttachmentCapability =
  | {
      readonly kind: 'enabled';
      readonly imageIngress: FlowImageDraftCommitPort;
      readonly assetIdentity: WorkspaceAssetIdentityPort;
    }
  | { readonly kind: 'disabled' };

function findReplacementTarget(
  request: ConversationNextRequest,
  historyBeforeTruncate: readonly RuntimeEvent[],
): Extract<RuntimeEvent, { type: 'user_input' }> | undefined {
  const targetId = request.options?.truncateFromMessageId;
  const reason = request.options?.truncateReason;
  if (!targetId || (reason !== 'edit' && reason !== 'regenerate')) return undefined;
  const target = historyBeforeTruncate.find(event => event.id === targetId);
  if (!target || target.type !== 'user_input') {
    throw new Error(`[FlowIncomingEvents] replacement target ${targetId} 不是当前会话的 user_input`);
  }
  return target;
}

function requireAttachmentId(createAttachmentId: () => string): string {
  const id = createAttachmentId();
  if (!id || id !== id.trim()) {
    throw new Error('[FlowIncomingEvents] attachment ID 生成器返回了非法身份');
  }
  return id;
}

function requireTargetAttachment(
  attachmentsById: ReadonlyMap<string, RuntimeResourceRef>,
  attachmentId: string,
): RuntimeResourceRef {
  const attachment = attachmentsById.get(attachmentId);
  if (!attachment) {
    throw new Error(`[FlowIncomingEvents] existing attachment ${attachmentId} 不属于 replacement target`);
  }
  return attachment;
}

export class FlowIncomingEventPreparer {
  constructor(
    private readonly attachmentCapability: FlowIncomingAttachmentCapability,
    private readonly createAttachmentId: () => string = () => `attachment_${randomUUID()}`,
  ) {}

  async prepare(params: {
    readonly request: ConversationNextRequest;
    readonly conversationId: string;
    readonly turnId: string;
    readonly historyBeforeTruncate: readonly RuntimeEvent[];
    readonly shouldPersist: boolean;
  }): Promise<FlowIncomingEventBatch> {
    const replacementTarget = findReplacementTarget(
      params.request,
      params.historyBeforeTruncate,
    );
    const resolvedUserAttachments: ResolvedFlowUserAttachments[] = [];

    for (const event of params.request.new_events ?? []) {
      if (event.type !== 'user_input') continue;
      if (!event.id) {
        throw new Error('[FlowIncomingEvents] user event 缺少入口分配的稳定 ID');
      }

      if (replacementTarget) {
        if (!event.attachment_selection) {
          throw new Error('[FlowIncomingEvents] edit/regenerate 必须显式提供 attachment selection');
        }
        const resolvedSelection = await this.resolveAttachmentSelection({
          eventId: event.id,
          selection: event.attachment_selection,
          targetAttachments: replacementTarget.attachments ?? [],
          createdAt: event.timestamp,
          shouldPersist: params.shouldPersist,
        });
        if (!event.content.trim() && resolvedSelection.attachments.length === 0) {
          throw new Error('[FlowIncomingEvents] replacement user input 不能同时缺少文本和附件');
        }
        resolvedUserAttachments.push(resolvedSelection);
      } else if (event.attachments?.length) {
        if (!params.shouldPersist) {
          throw new Error('[FlowIncomingEvents] draft 图片发送必须启用 durable persistence');
        }
        resolvedUserAttachments.push(await this.commitDraftAttachments(event.id, event.attachments, event.timestamp));
      }
    }

    return buildFlowIncomingEventBatch({
      request: params.request,
      conversationId: params.conversationId,
      turnId: params.turnId,
      resolvedUserAttachments,
    });
  }

  async releaseCommittedDrafts(batch: FlowIncomingEventBatch): Promise<void> {
    if (this.attachmentCapability.kind === 'disabled') return;
    for (const draftId of batch.committedDraftIds) {
      await this.attachmentCapability.imageIngress.releaseDraft(draftId);
    }
  }

  /**
   * 只有 event/link 事务成功后才能释放 draft。回调失败时保留进程内 committed 记录，
   * 同一请求可继续复用最终文件；未登记的最终文件由下次启动维护回收。
   */
  async persistAndRelease(
    batch: FlowIncomingEventBatch,
    persist: () => Promise<void>,
  ): Promise<void> {
    await persist();
    await this.releaseCommittedDrafts(batch);
  }

  private async commitDraftAttachments(
    eventId: string,
    draftRefs: readonly ConversationDraftAttachmentRef[],
    createdAt: number,
  ): Promise<ResolvedFlowUserAttachments> {
    if (this.attachmentCapability.kind === 'disabled') {
      throw new Error('[FlowIncomingEvents] 当前 host 未启用图片 ingress');
    }
    const draftIds = draftRefs.map(item => item.draftId);
    this.attachmentCapability.imageIngress.resolveDraftBatch(draftIds);

    const attachments: RuntimeResourceRef[] = [];
    const commitsByAssetId = new Map<string, WorkspaceAssetCommitRecord>();
    for (const draftRef of draftRefs) {
      const committed = await this.attachmentCapability.imageIngress.commitDraftFile(draftRef.draftId);
      const assetId = this.attachmentCapability.assetIdentity.resolveCanonicalAssetId(committed.uri);
      const attachment: RuntimeResourceRef = {
        id: requireAttachmentId(this.createAttachmentId),
        kind: 'image',
        resourceId: assetId,
        mediaType: committed.mediaType,
        byteLength: committed.byteLength,
        width: committed.width,
        height: committed.height,
        sha256: committed.sha256,
        ...(draftRef.fileName ?? committed.fileName
          ? { fileName: draftRef.fileName ?? committed.fileName }
          : {}),
        ...(draftRef.label ? { label: draftRef.label } : {}),
      };
      attachments.push(attachment);
      commitsByAssetId.set(assetId, {
        assetId,
        uri: committed.uri,
        mediaType: committed.mediaType,
        byteLength: committed.byteLength,
        width: committed.width,
        height: committed.height,
        sha256: committed.sha256,
        localPath: committed.localPath,
        createdAt,
      });
    }

    return {
      eventId,
      attachments,
      assetCommits: [...commitsByAssetId.values()],
      committedDraftIds: [...new Set(draftIds)],
    };
  }

  private async resolveAttachmentSelection(params: {
    readonly eventId: string;
    readonly selection: ConversationAttachmentSelection;
    readonly targetAttachments: readonly RuntimeResourceRef[];
    readonly createdAt: number;
    readonly shouldPersist: boolean;
  }): Promise<ResolvedFlowUserAttachments> {
    if (params.selection.mode === 'preserve') {
      return {
        eventId: params.eventId,
        attachments: params.targetAttachments,
        assetCommits: [],
        committedDraftIds: [],
      };
    }

    const targetByAttachmentId = new Map(
      params.targetAttachments.map(attachment => [attachment.id, attachment] as const),
    );
    const seenExistingIds = new Set<string>();
    const seenDraftIds = new Set<string>();
    const draftRefs: ConversationDraftAttachmentRef[] = [];
    for (const item of params.selection.items) {
      if (item.source === 'existing') {
        requireTargetAttachment(targetByAttachmentId, item.attachmentId);
        if (seenExistingIds.has(item.attachmentId)) {
          throw new Error(`[FlowIncomingEvents] existing attachment ${item.attachmentId} 重复选择`);
        }
        seenExistingIds.add(item.attachmentId);
        continue;
      }
      if (seenDraftIds.has(item.draft.draftId)) {
        throw new Error(`[FlowIncomingEvents] draft attachment ${item.draft.draftId} 重复选择`);
      }
      seenDraftIds.add(item.draft.draftId);
      draftRefs.push(item.draft);
    }

    if (draftRefs.length === 0) {
      return {
        eventId: params.eventId,
        attachments: params.selection.items.map(item => {
          if (item.source !== 'existing') {
            throw new Error('[FlowIncomingEvents] attachment selection 草稿解析状态不一致');
          }
          return requireTargetAttachment(targetByAttachmentId, item.attachmentId);
        }),
        assetCommits: [],
        committedDraftIds: [],
      };
    }
    if (!params.shouldPersist) {
      throw new Error('[FlowIncomingEvents] edit draft 图片必须启用 durable persistence');
    }

    const committedDrafts = await this.commitDraftAttachments(
      params.eventId,
      draftRefs,
      params.createdAt,
    );
    const committedByDraftId = new Map(
      draftRefs.map((draft, index) => [draft.draftId, committedDrafts.attachments[index]] as const),
    );
    return {
      eventId: params.eventId,
      attachments: params.selection.items.map(item => {
        const attachment = item.source === 'existing'
          ? targetByAttachmentId.get(item.attachmentId)
          : committedByDraftId.get(item.draft.draftId);
        if (!attachment) {
          throw new Error('[FlowIncomingEvents] attachment selection 解析结果缺失');
        }
        return attachment;
      }),
      assetCommits: committedDrafts.assetCommits,
      committedDraftIds: committedDrafts.committedDraftIds,
    };
  }
}
