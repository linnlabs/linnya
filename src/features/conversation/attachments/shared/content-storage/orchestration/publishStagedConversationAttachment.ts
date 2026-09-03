import {
  ManagedImagePublishError,
  publishStagedManagedImage,
  type ManagedImagePendingPublish,
  type ManagedImageWritableStoragePaths,
} from 'src/domains/assets/shared/managed-image-storage';
import { ConversationAttachmentPublishError } from '../definitions/conversationAttachmentPublish';

/**
 * 把已复核的 staging 文件原子发布到内容寻址路径。
 * 目标已存在时必须再次验证 hash，不能把文件名当作内容事实。
 */
export async function publishStagedConversationAttachment(params: {
  readonly paths: ManagedImageWritableStoragePaths;
  readonly publishId: string;
  readonly stagingPath: string;
  readonly finalPath: string;
  readonly expectedSha256: string;
}): Promise<ManagedImagePendingPublish> {
  try {
    return await publishStagedManagedImage(params);
  } catch (error: unknown) {
    if (error instanceof ManagedImagePublishError) {
      throw new ConversationAttachmentPublishError('content_address_conflict');
    }
    throw error;
  }
}
