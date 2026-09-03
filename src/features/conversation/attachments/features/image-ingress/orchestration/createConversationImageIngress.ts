import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type {
  CommittedConversationImageFile,
  ConversationImageDraft,
  ConversationImageIngressPolicy,
  ConversationImageIngressPort,
} from '../definitions/conversationImageIngress';
import { ConversationImageIngressError } from '../definitions/conversationImageIngress';
import { inspectConversationImage } from '../functions/inspectConversationImage';
import {
  createConversationImageContentIdentity,
  createConversationAttachmentStoragePaths,
} from '../../../shared/storage-paths';
import {
  hasSameConversationImageIdentity,
  normalizeConversationImageFileName,
  validateConversationImageAttachmentCount,
  validateConversationImageDraftTotalBytes,
  validateConversationImageIngressPolicy,
} from '../functions/validateConversationImageIngress';
import {
  ConversationAttachmentPublishError,
  publishStagedConversationAttachment,
} from '../../../shared/content-storage';
import {
  completeManagedImagePublish,
  type ManagedImagePendingPublish,
} from 'src/domains/assets/shared/managed-image-storage';

interface StagedDraftRecord {
  readonly draft: ConversationImageDraft;
  readonly stagingPath: string;
  committed?: CommittedConversationImageFile;
  pendingPublish?: ManagedImagePendingPublish;
  commitPromise?: Promise<CommittedConversationImageFile>;
}

async function readSourceBytes(params: {
  readonly sourcePath: string;
  readonly maxImageBytes: number;
}): Promise<Buffer> {
  let stat;
  try {
    stat = await fsp.stat(params.sourcePath);
  } catch {
    throw new ConversationImageIngressError('source_not_found', '图片源文件不存在');
  }
  if (!stat.isFile()) {
    throw new ConversationImageIngressError('source_not_file', '图片源路径不是普通文件');
  }
  if (stat.size > params.maxImageBytes) {
    throw new ConversationImageIngressError(
      'image_too_large',
      `图片字节数超过限制: actual=${stat.size}, max=${params.maxImageBytes}`,
    );
  }
  return fsp.readFile(params.sourcePath);
}

/**
 * 创建单进程图片 ingress port。
 * 初始化时先清掉上次进程遗留的 staging；必须在暴露任何 stage 调用前完成。
 */
export async function createConversationImageIngress(params: {
  readonly appDataRoot: string;
  readonly storeId: string;
  readonly policy: ConversationImageIngressPolicy;
  readonly createDraftId?: () => string;
}): Promise<ConversationImageIngressPort> {
  validateConversationImageIngressPolicy(params.policy);
  const paths = createConversationAttachmentStoragePaths(params.appDataRoot, params.storeId);
  await fsp.rm(paths.stagingRoot, { recursive: true, force: true });
  await fsp.mkdir(paths.stagingRoot, { recursive: true });
  await fsp.mkdir(paths.contentRoot, { recursive: true });

  const records = new Map<string, StagedDraftRecord>();
  const createDraftId = params.createDraftId ?? (() => `draft_${randomUUID()}`);

  function readRecord(draftId: string): StagedDraftRecord {
    const record = records.get(draftId);
    if (!record) {
      throw new ConversationImageIngressError('draft_not_found', `图片草稿不存在: ${draftId}`);
    }
    return record;
  }

  async function stageManagedBytes(input: {
    readonly bytes: Buffer;
    readonly fileName?: string;
  }): Promise<ConversationImageDraft> {
    const draftId = createDraftId();
    if (
      !draftId.trim()
      || draftId !== draftId.trim()
      || draftId.length > 200
      || draftId.includes('/')
      || draftId.includes('\\')
      || records.has(draftId)
    ) {
      throw new ConversationImageIngressError('draft_id_conflict', 'draft ID 生成器返回了空值或重复值');
    }

    const normalizedFileName = normalizeConversationImageFileName(input.fileName);
    const draft = await inspectConversationImage({
      bytes: input.bytes,
      policy: params.policy,
      draftId,
      fileName: normalizedFileName,
    });
    const stagingPath = path.join(paths.stagingRoot, `${draftId}.upload`);
    await fsp.writeFile(stagingPath, input.bytes, { flag: 'wx' });
    records.set(draftId, { draft, stagingPath });
    return draft;
  }

  async function commitRecord(record: StagedDraftRecord): Promise<CommittedConversationImageFile> {
    const bytes = await fsp.readFile(record.stagingPath).catch(() => {
      throw new ConversationImageIngressError('draft_file_changed', '图片草稿文件已丢失');
    });
    let verified: ConversationImageDraft;
    try {
      verified = await inspectConversationImage({
        bytes,
        policy: params.policy,
        draftId: record.draft.draftId,
        fileName: record.draft.fileName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConversationImageIngressError(
        'draft_file_changed',
        `图片草稿在提交前无法通过复核: ${message}`,
      );
    }
    if (!hasSameConversationImageIdentity(verified, record.draft)) {
      throw new ConversationImageIngressError('draft_file_changed', '图片草稿在提交前发生变化');
    }

    const identity = createConversationImageContentIdentity({
      paths,
      sha256: verified.sha256,
      mediaType: verified.mediaType,
    });
    try {
      record.pendingPublish = await publishStagedConversationAttachment({
        paths,
        publishId: record.draft.draftId,
        stagingPath: record.stagingPath,
        finalPath: identity.localPath,
        expectedSha256: verified.sha256,
      });
    } catch (error: unknown) {
      if (error instanceof ConversationAttachmentPublishError) {
        throw new ConversationImageIngressError(
          'draft_file_changed',
          '内容寻址目标与已验证草稿不一致',
        );
      }
      throw error;
    }
    const committed: CommittedConversationImageFile = {
      ...verified,
      uri: identity.uri,
      localPath: identity.localPath,
    };
    record.committed = committed;
    return committed;
  }

  return {
    async stageImage({ sourcePath, fileName }): Promise<ConversationImageDraft> {
      const bytes = await readSourceBytes({
        sourcePath,
        maxImageBytes: params.policy.maxImageBytes,
      });
      return stageManagedBytes({
        bytes,
        fileName: fileName ?? path.basename(sourcePath),
      });
    },

    async stageImageBytes({ bytes, fileName }): Promise<ConversationImageDraft> {
      return stageManagedBytes({ bytes, fileName });
    },

    resolveDraft(draftId): ConversationImageDraft | null {
      return records.get(draftId)?.draft ?? null;
    },

    resolveDraftBatch(draftIds): readonly ConversationImageDraft[] {
      validateConversationImageAttachmentCount(draftIds.length, params.policy);
      const drafts = draftIds.map((draftId) => readRecord(draftId).draft);
      validateConversationImageDraftTotalBytes(drafts, params.policy);
      return drafts;
    },

    async commitDraftFile(draftId): Promise<CommittedConversationImageFile> {
      const record = readRecord(draftId);
      if (record.committed) return record.committed;
      if (record.commitPromise) return record.commitPromise;
      record.commitPromise = commitRecord(record);
      try {
        return await record.commitPromise;
      } finally {
        record.commitPromise = undefined;
      }
    },

    async releaseDraft(draftId): Promise<void> {
      const record = records.get(draftId);
      if (!record) return;
      if (record.commitPromise) {
        await record.commitPromise;
      }
      if (record.committed && record.pendingPublish) {
        await completeManagedImagePublish(record.pendingPublish);
      }
      await fsp.rm(record.stagingPath, { force: true });
      records.delete(draftId);
    },
  };
}
