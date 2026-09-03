import type {
  ConversationImageDraft,
  ConversationImageIngressPolicy,
} from '../definitions/conversationImageIngress';
import { ConversationImageIngressError } from '../definitions/conversationImageIngress';
import {
  inspectImageBytes,
  ImageInspectionError,
} from 'src/shared/media/image-inspection';

export async function inspectConversationImage(params: {
  readonly bytes: Buffer;
  readonly policy: ConversationImageIngressPolicy;
  readonly draftId: string;
  readonly fileName?: string;
}): Promise<ConversationImageDraft> {
  if (params.bytes.length > params.policy.maxImageBytes) {
    throw new ConversationImageIngressError(
      'image_too_large',
      `图片字节数超过限制: actual=${params.bytes.length}, max=${params.policy.maxImageBytes}`,
    );
  }

  try {
    const inspected = await inspectImageBytes({
      bytes: params.bytes,
      maxImagePixels: params.policy.maxImagePixels,
    });

    return {
      draftId: params.draftId,
      kind: 'image',
      mediaType: inspected.mediaType,
      byteLength: inspected.byteLength,
      width: inspected.width,
      height: inspected.height,
      sha256: inspected.sha256,
      ...(params.fileName ? { fileName: params.fileName } : {}),
    };
  } catch (error) {
    if (error instanceof ImageInspectionError) {
      throw new ConversationImageIngressError(error.code, error.message);
    }
    throw error;
  }
}
