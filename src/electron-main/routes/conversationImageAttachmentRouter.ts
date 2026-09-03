import busboy from 'busboy';
import { Router, type Request, type Response } from 'express';
import type {
  ConversationImageAttachmentErrorCode,
  ConversationImageDraftStageResponse,
} from '@app/schemas';
import {
  ConversationImageIngressError,
  type ConversationImageIngressPort,
} from 'src/features/conversation/attachments/features/image-ingress';
import { Logger } from 'src/shared/logger';

const logger = new Logger('ConversationImageAttachmentRouter');

type ConversationImageStagingPort = Pick<
  ConversationImageIngressPort,
  'stageImageBytes' | 'releaseDraft'
>;

interface ParsedImageUpload {
  readonly bytes: Buffer;
  readonly fileName?: string;
}

class ImageUploadParseError extends Error {
  readonly name = 'ImageUploadParseError';

  constructor(readonly code: 'invalid_request' | 'too_large') {
    super(code);
  }
}

function parseSingleImageUpload(
  req: Request,
  maxImageBytes: number,
): Promise<ParsedImageUpload> {
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: {
          fileSize: maxImageBytes,
          files: 1,
          fields: 0,
        },
      });
    } catch {
      reject(new ImageUploadParseError('invalid_request'));
      return;
    }

    let fileSeen = false;
    let fileCompleted = false;
    let fileName: string | undefined;
    let totalBytes = 0;
    const chunks: Buffer[] = [];
    let parseError: ImageUploadParseError | null = null;
    let settled = false;

    const rememberError = (error: ImageUploadParseError): void => {
      parseError ??= error;
    };
    const rejectOnce = (error: ImageUploadParseError): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    parser.on('file', (fieldName, stream, info) => {
      if (fileSeen || fieldName !== 'file') {
        rememberError(new ImageUploadParseError('invalid_request'));
      }
      fileSeen = true;
      fileName = info.filename || undefined;

      stream.on('limit', () => {
        rememberError(new ImageUploadParseError('too_large'));
      });
      stream.on('data', (chunk: Buffer) => {
        // 只在 busboy 的硬上限内持有字节；完整 multipart 合法前绝不签发 draft。
        if (parseError) return;
        totalBytes += chunk.length;
        chunks.push(chunk);
      });
      stream.on('error', () => {
        rememberError(new ImageUploadParseError('invalid_request'));
      });
      stream.on('end', () => {
        fileCompleted = true;
      });
    });

    parser.on('filesLimit', () => {
      rememberError(new ImageUploadParseError('invalid_request'));
    });
    parser.on('fieldsLimit', () => {
      rememberError(new ImageUploadParseError('invalid_request'));
    });
    parser.on('error', () => {
      rejectOnce(new ImageUploadParseError('invalid_request'));
    });
    parser.on('close', () => {
      if (settled) return;
      if (parseError) {
        rejectOnce(parseError);
        return;
      }
      if (!fileSeen || !fileCompleted) {
        rejectOnce(new ImageUploadParseError('invalid_request'));
        return;
      }
      settled = true;
      resolve({
        bytes: Buffer.concat(chunks, totalBytes),
        ...(fileName ? { fileName } : {}),
      });
    });

    req.once('aborted', () => {
      rejectOnce(new ImageUploadParseError('invalid_request'));
    });
    req.once('error', () => {
      rejectOnce(new ImageUploadParseError('invalid_request'));
    });
    req.pipe(parser);
  });
}

function mapImageIngressError(error: unknown): {
  readonly status: number;
  readonly code: ConversationImageAttachmentErrorCode;
} {
  if (error instanceof ImageUploadParseError) {
    return error.code === 'too_large'
      ? { status: 413, code: 'conversation.image.too_large' }
      : { status: 400, code: 'conversation.image.invalid_request' };
  }
  if (error instanceof ConversationImageIngressError) {
    switch (error.code) {
      case 'image_too_large':
        return { status: 413, code: 'conversation.image.too_large' };
      case 'unsupported_image_format':
        return { status: 415, code: 'conversation.image.unsupported_format' };
      case 'invalid_image':
        return { status: 422, code: 'conversation.image.invalid_image' };
      case 'image_pixel_limit_exceeded':
        return { status: 422, code: 'conversation.image.pixel_limit_exceeded' };
      case 'invalid_file_name':
        return { status: 400, code: 'conversation.image.invalid_file_name' };
      default:
        return { status: 500, code: 'conversation.image.staging_failed' };
    }
  }
  return { status: 500, code: 'conversation.image.staging_failed' };
}

function sendImageError(res: Response, error: unknown): void {
  const mapped = mapImageIngressError(error);
  const errorName = error instanceof Error ? error.name : typeof error;
  const context = { status: mapped.status, code: mapped.code, errorName };
  if (mapped.status >= 500) {
    logger.error('图片草稿请求失败', context);
  } else {
    logger.warn('图片草稿请求被拒绝', context);
  }
  res.status(mapped.status).json({ code: mapped.code });
}

function isValidDraftId(value: string): boolean {
  return value.length > 0
    && value.length <= 200
    && value === value.trim()
    && !value.includes('/')
    && !value.includes('\\');
}

export function createConversationImageAttachmentRouter(params: {
  readonly imageIngress: ConversationImageStagingPort;
  readonly maxImageBytes: number;
}): Router {
  if (!Number.isSafeInteger(params.maxImageBytes) || params.maxImageBytes <= 0) {
    throw new Error('conversation image multipart limit 必须是正安全整数');
  }

  const router = Router();

  router.post('/attachments/images', async (req, res) => {
    try {
      const upload = await parseSingleImageUpload(req, params.maxImageBytes);
      // multipart MIME 仅是传输声明，真实 mediaType/尺寸/hash 一律由 ingress 解码得出。
      const draft = await params.imageIngress.stageImageBytes(upload);
      const response: ConversationImageDraftStageResponse = {
        draft: {
          draftId: draft.draftId,
          kind: 'image',
          ...(draft.fileName ? { fileName: draft.fileName } : {}),
        },
        mediaType: draft.mediaType,
        byteLength: draft.byteLength,
        width: draft.width,
        height: draft.height,
        sha256: draft.sha256,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(response);
    } catch (error: unknown) {
      sendImageError(res, error);
    }
  });

  router.delete('/attachments/images/:draftId', async (req, res) => {
    const { draftId } = req.params;
    if (!isValidDraftId(draftId)) {
      sendImageError(res, new ImageUploadParseError('invalid_request'));
      return;
    }
    try {
      await params.imageIngress.releaseDraft(draftId);
      res.status(204).send();
    } catch (error: unknown) {
      sendImageError(res, error);
    }
  });

  return router;
}
