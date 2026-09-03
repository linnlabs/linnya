import { createHash } from 'node:crypto';

import {
  ManagedImageIngressError,
  type ManagedImageIngressPort,
} from 'src/domains/assets/features/managed-image-ingress';
import type { ToolResultAssetClaimRegistryPort } from 'src/domains/assets/features/tool-result-claims';
import { ImageInspectionError } from 'src/shared/media/image-inspection';
import {
  PhysicalFileReadError,
  type PhysicalFileReaderPort,
  type PhysicalFileReadScope,
  type PhysicalFileToolReadResult,
} from '../definitions/physicalFileRead';

function projectIngressError(error: unknown): never {
  if (error instanceof ManagedImageIngressError) {
    switch (error.failure) {
      case 'source_not_found':
        throw new PhysicalFileReadError('READ_FILE_NOT_FOUND', '图片源文件不存在。');
      case 'source_not_file':
        throw new PhysicalFileReadError('READ_FILE_NOT_REGULAR_FILE', '图片源路径不是普通文件。');
      case 'source_too_large':
        throw new PhysicalFileReadError('READ_FILE_FILE_TOO_LARGE', '图片超过 read_file 字节上限。');
      case 'content_address_conflict':
        throw new PhysicalFileReadError(
          'READ_FILE_IMAGE_INTEGRITY_FAILED',
          '图片内容寻址目标与已验证内容不一致。',
        );
      case 'invalid_byte_limit':
      case 'invalid_pixel_limit':
        throw error;
    }
  }
  if (error instanceof ImageInspectionError) {
    throw new PhysicalFileReadError(
      'READ_FILE_IMAGE_INTEGRITY_FAILED',
      `图片完整性校验失败：${error.message}`,
    );
  }
  throw error;
}

/**
 * 物理文件与 asset domain 的 app-level 编排点。它保留 locator identity，图片则复用
 * managed ingress 与一次性 claim，避免把内部 asset URI 冒充用户读取的文件地址。
 */
export async function readPhysicalFileForTool(input: {
  readonly reader: PhysicalFileReaderPort;
  readonly imageIngress: ManagedImageIngressPort;
  readonly claims: ToolResultAssetClaimRegistryPort;
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly locator: string;
  readonly absolutePath: string;
  readonly scope: PhysicalFileReadScope;
  /** 只能在内容识别为图片后拒绝；拒绝必须发生在 ingress 和 claim 之前。 */
  readonly hasExplicitTextWindow: boolean;
  /** 由 app-level history projection 判断相同像素是否已进入当前 run。 */
  readonly hasAttachedImageContent: (sha256: string) => boolean;
}): Promise<PhysicalFileToolReadResult> {
  const physical = await input.reader.readFile({
    absolutePath: input.absolutePath,
    scope: input.scope,
  });
  if (physical.kind === 'text') {
    return Object.freeze({ ...physical, locator: input.locator });
  }
  if (input.hasExplicitTextWindow) {
    throw new PhysicalFileReadError(
      'READ_FILE_IMAGE_WINDOW_CONFLICT',
      '图片没有字符窗口；请只传 locator。',
    );
  }

  let asset;
  try {
    asset = await input.imageIngress.ingestLocalImage({ sourcePath: physical.resolvedPath });
  } catch (error: unknown) {
    projectIngressError(error);
  }

  const imageFacts = {
    kind: 'image' as const,
    locator: input.locator,
    resolvedPath: physical.resolvedPath,
    fileName: physical.fileName,
    contentType: asset.mediaType,
    byteLength: asset.byteLength,
    width: asset.width,
    height: asset.height,
  };
  if (input.hasAttachedImageContent(asset.sha256)) {
    return Object.freeze({
      ...imageFacts,
      attachmentStatus: 'already_attached' as const,
    });
  }

  const selectionId = `read-file-physical:${createHash('sha256')
    .update(input.locator)
    .digest('hex')}`;
  const [claim] = input.claims.issueClaims({
    conversationId: input.conversationId,
    toolCallId: input.toolCallId,
    selections: [{ selectionId, assetId: asset.assetId }],
  });
  if (!claim || claim.selectionId !== selectionId) {
    throw new Error('[READ_FILE_TOOL_RESULT_CLAIM_MISSING] 图片 claim registry 未返回对应选择。');
  }

  return Object.freeze({
    ...imageFacts,
    attachmentStatus: 'attached',
    selection: Object.freeze({ id: selectionId, uri: claim.uri }),
  });
}
