import { Router, type Response } from 'express';
import type { ConversationImageAttachmentErrorCode } from '@app/schemas';
import {
  WorkspaceImagePreviewError,
  type WorkspaceImagePreviewPort,
} from 'src/features/workspace/assets/features/image-preview';
import { Logger } from 'src/shared/logger';

const logger = new Logger('WorkspaceImagePreviewRouter');

function isValidAssetId(value: string): boolean {
  return value.length > 0
    && value.length <= 200
    && value === value.trim()
    && !value.includes('/')
    && !value.includes('\\');
}

function mapPreviewError(error: unknown): {
  readonly status: number;
  readonly code: ConversationImageAttachmentErrorCode;
} {
  if (error instanceof WorkspaceImagePreviewError) {
    return error.code === 'asset_unavailable'
      ? { status: 404, code: 'conversation.image.asset_not_found' }
      : { status: 422, code: 'conversation.image.asset_integrity_failed' };
  }
  return { status: 500, code: 'conversation.image.preview_failed' };
}

function sendPreviewError(res: Response, error: unknown): void {
  const mapped = mapPreviewError(error);
  const context = {
    status: mapped.status,
    code: mapped.code,
    errorName: error instanceof Error ? error.name : typeof error,
  };
  if (mapped.status >= 500) {
    logger.error('Workspace 图片预览失败', context);
  } else {
    logger.warn('Workspace 图片预览不可用', context);
  }
  res.status(mapped.status).json({ code: mapped.code });
}

/**
 * 受管图片内容出口。
 *
 * 只接受 durable asset ID，并在返回 bytes 前经过 workspace verified-image 复核；
 * 资源库和会话 UI 共用这一出口，Renderer 不读取账本中的本地路径。
 */
export function createWorkspaceImagePreviewRouter(params: {
  readonly imagePreview: WorkspaceImagePreviewPort;
}): Router {
  const router = Router();

  router.get('/assets/images/:assetId/content', async (req, res) => {
    const { assetId } = req.params;
    if (!isValidAssetId(assetId) || Object.keys(req.query).length > 0) {
      res.status(400).json({ code: 'conversation.image.invalid_request' });
      return;
    }

    try {
      const image = await params.imagePreview.readImage(assetId);
      res.status(200);
      res.setHeader('Content-Type', image.mediaType);
      res.setHeader('Content-Length', String(image.byteLength));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(Buffer.from(image.bytes));
    } catch (error: unknown) {
      sendPreviewError(res, error);
    }
  });

  return router;
}
