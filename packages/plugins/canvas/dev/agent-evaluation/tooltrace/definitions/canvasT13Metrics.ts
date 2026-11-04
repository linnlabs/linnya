import { z } from 'zod';
import { CanvasCardIdSchema, CanvasChangedEventSchema } from '@plugin/canvas/shared';
import type { CanvasEvaluationCommand } from '../../bridge/definitions/canvasEvaluationBridge';

const time = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();
const camera = z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() });
const environment = z.object({ camera, visibilityState: z.enum(['visible', 'hidden']), screenPixelRatio: z.number().positive(),
  theme: z.string().nullable().optional(), fontFamily: z.string().optional(), fontSmoothing: z.string().optional() }).strip();
export const CanvasT13MetricsRequestSchema = z.object({
  runDirectory: z.string().min(1), collectionLabel: z.string().regex(/^[a-zA-Z0-9-]+$/),
  observationDirectory: z.string().min(1),
}).strict();
export const CanvasT13ProtocolSchema = z.object({
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), batchId: z.string(), projectId: z.string(),
  documentId: z.string(), startedAt: time, initialSequence: count,
  naturalEnvironment: environment,
  measurement: z.literal('backend-commit-to-post-fit-observed-overview-geometry-upper-bound'),
  body: z.literal('separate-not-implied'),
}).strip();
export const CanvasT13SummarySchema = z.object({
  sourceRevision: z.string(), batchId: z.string(), documentId: z.string(), endedAt: time,
  terminalObservedAt: time.nullable(), sampleCount: count,
}).strip();
const card = z.object({ id: CanvasCardIdSchema, revision: count }).strip();
export const CanvasT13CommitRowSchema = z.object({
  event: CanvasChangedEventSchema,
  scope: z.object({ sequence: count, cards: z.array(card), deletedCardIds: z.array(CanvasCardIdSchema) }).strip().optional(),
}).strip();
export const CanvasT13ReadinessSchema = z.object({
  documentId: z.string(), sequence: count, renders: count, observedAt: time,
  readiness: z.object({
    cards: z.array(card.extend({
      revision: count.nullable(), mode: z.enum(['body', 'overview', 'thumbnail', 'outside']),
      status: z.enum(['not_required', 'ready', 'awaiting_draw', 'pending', 'failed']),
    })),
    complete: z.boolean(), suspended: z.boolean(), precisionSettling: z.boolean(),
  }).strip(),
  environment,
}).strip();
export const CanvasT13FitSchema = z.object({ camera, renders: count, sceneTransitions: count, observedAt: time }).strip();
export const CanvasT13FrameSampleSchema = z.object({ at: time, interval: z.number().finite().positive() }).strict();
export const CanvasT13FrameWindowSchema = z.object({
  documentId: z.string(), frames: z.object({
    kind: z.literal('animation-frame-callbacks-in-explicit-window'),
    since: time, until: time, observedAt: time, retainedSince: time, capturedThrough: time,
    retentionComplete: z.boolean(), visibility: z.enum(['visible', 'hidden']), focused: z.boolean(),
    samples: z.array(CanvasT13FrameSampleSchema), boundarySamples: z.array(CanvasT13FrameSampleSchema),
  }).strip(),
}).strip();
export const CanvasT13ObservationSchema = z.object({
  sequence: count, status: z.string(), row: CanvasT13CommitRowSchema,
  targets: z.array(card).optional(), fit: CanvasT13FitSchema.optional(),
  natural: CanvasT13ReadinessSchema.optional(),
  samples: z.array(z.object({ readiness: CanvasT13ReadinessSchema,
    presentation: z.object({ sceneTransitions: count }).strip(), receivedAt: time }).strip()).optional(),
  receipt: z.object({ sequence: count, status: z.literal('geometry-observed'), observedAt: time,
    receivedAt: time, renders: count, zeroBaseline: count }).strip().optional(),
  frameWindow: CanvasT13FrameWindowSchema.optional(),
}).strip();
export interface CanvasT13BridgeExchange {
  readonly command: CanvasEvaluationCommand;
  readonly requestedAt: number;
  readonly receivedAt: number;
  readonly value: unknown;
  readonly requestFile: string;
  readonly responseFile: string;
}
export type CanvasT13Observation = z.infer<typeof CanvasT13ObservationSchema>;
export type CanvasT13FrameSample = z.infer<typeof CanvasT13FrameSampleSchema>;
