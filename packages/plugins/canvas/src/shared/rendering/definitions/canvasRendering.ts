import { z } from 'zod';
import {
  DocumentPreviewImageSchema,
  DocumentPreviewContentSchema,
  DocumentPreviewDetailSchema,
  DocumentPreviewResultSchema,
  DocumentReferencePresentationSchema,
} from '@app/schemas';
import {
  CanvasSnapshotSchema,
  CanvasTextDocumentSchema,
} from '../../model/definitions/canvasElement';

export const CANVAS_RENDER_WORKER_ID = 'canvas-render';
export const CANVAS_RENDER_PROTOCOL = 1;
export const CANVAS_RENDER_CHANNELS = {
  request: 'canvas-render:request',
  response: 'canvas-render:response',
  ready: 'canvas-render:ready',
  cancel: 'canvas-render:cancel',
  viewport: 'canvas-render:viewport',
} as const;
/** 输出与隐藏窗口使用同一物理像素预算；分数DPR须先上取整再计量。 */
export const CANVAS_RENDER_VIEWPORT_LIMITS = {
  maxWidth: 16384,
  maxHeight: 16384,
  maxPixels: 16_777_216,
} as const;
const finite = z.number().finite();
const resource = z
  .string()
  .max(32 * 1024 * 1024)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
const common = {
  protocol: z.literal(CANVAS_RENDER_PROTOCOL),
  requestId: z.string().min(1),
  theme: z.enum(['light', 'dark']),
  dpr: finite.min(0.25).max(4),
  fontFamily: z.string().min(1).max(256),
  fontSize: finite.min(8).max(72),
  uiScale: finite.min(0.5).max(4).default(1),
  assets: z.record(z.string(), resource).default({}),
  documents: z
    .record(
      z.string(),
      z
        .object({
          title: z.string(),
          status: DocumentReferencePresentationSchema.shape.status.optional(),
          previewStatus: DocumentPreviewResultSchema.shape.status.optional(),
          summary: DocumentPreviewContentSchema.shape.summary.optional(),
          /** 内容 owner 的完整预览载荷，首屏由共享预览按实际布局裁切。 */
          body: DocumentPreviewDetailSchema.optional(),
          keepThumbnail: z.boolean().optional(),
          image: DocumentPreviewImageSchema.shape.dataUri.optional(),
        })
        .strict()
    )
    .default({}),
};
export const CanvasMeasureRequestSchema = z
  .object({
    ...common,
    kind: z.literal('measure'),
    content: CanvasTextDocumentSchema,
    width: finite.positive().max(4096),
  })
  .strict();
export const CanvasMeasureBatchRequestSchema = z
  .object({
    ...common,
    kind: z.literal('measureBatch'),
    cards: z
      .array(
        z
          .object({
            ref: z.string().min(1),
            contentVersion: z.literal(1),
            content: CanvasTextDocumentSchema,
            width: finite.positive().max(4096),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict()
  .refine(request => new Set(request.cards.map(card => card.ref)).size === request.cards.length, {
    message: 'Duplicate measurement ref',
  });
export const CanvasRenderRequestSchema = z
  .object({
    ...common,
    kind: z.literal('render'),
    snapshot: CanvasSnapshotSchema,
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    region: z
      .object({ x: finite, y: finite, width: finite.positive(), height: finite.positive() })
      .strict()
      .nullable(),
    format: z.enum(['png', 'jpeg']),
    quality: finite.min(0.1).max(1),
    material: z.enum(['paper', 'card']),
  })
  .strict()
  .refine(
    request =>
      Math.ceil(request.width * request.dpr) * Math.ceil(request.height * request.dpr) <=
      CANVAS_RENDER_VIEWPORT_LIMITS.maxPixels,
    { message: 'Canvas output exceeds pixel budget' }
  );
export const CanvasWorkerRequestSchema = z.union([
  CanvasMeasureRequestSchema,
  CanvasMeasureBatchRequestSchema,
  CanvasRenderRequestSchema,
]);
export const CanvasWorkerResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('measured'),
      requestId: z.string().min(1),
      width: finite.positive(),
      height: finite.positive(),
    })
    .strict(),
  z
    .object({
      status: z.literal('measuredBatch'),
      requestId: z.string().min(1),
      cards: z
        .array(
          z
            .object({
              ref: z.string().min(1),
              width: finite.positive(),
              height: finite.positive(),
            })
            .strict()
        )
        .max(500),
    })
    .strict(),
  z
    .object({
      status: z.literal('rendered'),
      requestId: z.string().min(1),
      sequence: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      format: z.enum(['png', 'jpeg']),
      dataUrl: resource,
    })
    .strict(),
  z
    .object({
      status: z.literal('failure'),
      requestId: z.string().min(1),
      code: z.enum(['invalid_request', 'cancelled', 'render_failed', 'resource_unavailable']),
      message: z.string().min(1),
    })
    .strict(),
]);
export const CanvasWorkerResponseSchema = z
  .object({
    protocol: z.literal(CANVAS_RENDER_PROTOCOL),
    requestId: z.string().min(1),
    result: CanvasWorkerResultSchema,
  })
  .strict()
  .refine(response => response.requestId === response.result.requestId, {
    message: 'Canvas worker response identity mismatch',
  });
export const CanvasWorkerReadySchema = z
  .object({ protocol: z.literal(CANVAS_RENDER_PROTOCOL) })
  .strict();
export const CanvasWorkerCancelSchema = z
  .object({ protocol: z.literal(CANVAS_RENDER_PROTOCOL), requestId: z.string().min(1) })
  .strict();
export type CanvasMeasureRequest = z.infer<typeof CanvasMeasureRequestSchema>;
export type CanvasMeasureBatchRequest = z.infer<typeof CanvasMeasureBatchRequestSchema>;
export type CanvasRenderRequest = z.infer<typeof CanvasRenderRequestSchema>;
export type CanvasWorkerRequest = z.infer<typeof CanvasWorkerRequestSchema>;
export type CanvasWorkerResult = z.infer<typeof CanvasWorkerResultSchema>;
export interface CanvasRenderBridge {
  setHandler(handler: (request: CanvasWorkerRequest) => Promise<CanvasWorkerResult>): void;
  setCancelHandler(handler: (requestId: string) => void): void;
  /** 只调整本 worker 的文档比例，不暴露 Electron 对象。 */
  setPixelRatio(ratio: number): void;
  /** 仅当前串行任务可调整隐藏窗口，不能让排队请求抢改在途绘图的视口。 */
  prepareViewport(size: { readonly width: number; readonly height: number }): Promise<void>;
  ready(): void;
}
