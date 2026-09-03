/**
 * @file conversationImageIngress.ts
 * @description 会话导入图片草稿的公共合同。
 *
 * 中文说明：
 * - draft 身份只在 host 进程内有效，不进入事件、消息或数据库；
 * - 图片事实全部来自 host 对受管副本的真实解码，不信任调用方声明；
 * - assetId 要等 SQLite 事务登记后才能确定，因此本合同只负责文件提交结果。
 */

import type { SupportedImageMediaType } from 'src/shared/media/image-inspection';

export type { SupportedImageMediaType } from 'src/shared/media/image-inspection';
export type { ConversationAttachmentStoragePaths } from '../../../shared/storage-paths';

export interface ConversationImageIngressPolicy {
  readonly maxImageBytes: number;
  readonly maxImagePixels: number;
  readonly maxAttachmentsPerMessage: number;
  readonly maxTotalBytesPerMessage: number;
}

export interface ConversationImageDraft {
  readonly draftId: string;
  readonly kind: 'image';
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly fileName?: string;
}

export interface CommittedConversationImageFile extends ConversationImageDraft {
  /** 不含绝对路径、可安全写入 assets.uri 的内容寻址 URI。 */
  readonly uri: string;
  /** 仅供 host 持久化与 materializer 使用，不能发送给 Renderer。 */
  readonly localPath: string;
}

export type ConversationImageIngressErrorCode =
  | 'invalid_policy'
  | 'source_not_found'
  | 'source_not_file'
  | 'image_too_large'
  | 'unsupported_image_format'
  | 'invalid_image'
  | 'image_pixel_limit_exceeded'
  | 'invalid_file_name'
  | 'draft_id_conflict'
  | 'draft_not_found'
  | 'draft_file_changed'
  | 'too_many_attachments'
  | 'message_images_too_large';

/** 调用方按 code 映射用户文案；错误消息只提供 host 调试上下文。 */
export class ConversationImageIngressError extends Error {
  readonly name = 'ConversationImageIngressError';

  constructor(
    readonly code: ConversationImageIngressErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ConversationImageIngressPort {
  /** 把用户选择的文件复制进受管 staging，完成真实解码后签发 draft。 */
  stageImage(params: {
    readonly sourcePath: string;
    readonly fileName?: string;
  }): Promise<ConversationImageDraft>;

  /** 把受限 HTTP 上传字节直接写入受管 staging，不额外创建临时文件。 */
  stageImageBytes(params: {
    readonly bytes: Buffer;
    readonly fileName?: string;
  }): Promise<ConversationImageDraft>;

  /** 只返回已验证元数据，不暴露 staging 路径。 */
  resolveDraft(draftId: string): ConversationImageDraft | null;

  /** 在发送前校验消息级数量和总字节上限，并保持调用方顺序。 */
  resolveDraftBatch(draftIds: readonly string[]): readonly ConversationImageDraft[];

  /**
   * 复核 staging 文件未变化后，原子移动到内容寻址目录。
   * 同一 draft 重试以及多个相同内容 draft 并发提交都返回同一最终文件身份。
   */
  commitDraftFile(draftId: string): Promise<CommittedConversationImageFile>;

  /** 用户移除草稿或 DB 提交成功后释放进程内身份。 */
  releaseDraft(draftId: string): Promise<void>;
}
