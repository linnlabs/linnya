import { z } from 'zod';
import type {
  NormalizedClusterAdvanceRequest,
  NormalizedTextMeasureInput,
  TextMeasureResult,
} from '../../index.js';

export const PROTOCOL_VERSION = 1 as const;

export const MEASUREMENT_WORKER_READY_CHANNEL = 'measurement:worker-ready';
export const MEASUREMENT_BATCH_REQUEST_CHANNEL = 'measurement:batch-request';
export const MEASUREMENT_BATCH_RESPONSE_CHANNEL = 'measurement:batch-response';

const TextMeasureParagraphSchema = z.object({
  text: z.string(),
  indentInches: z.number().optional(),
  spacingBeforePt: z.number().optional(),
  spacingAfterPt: z.number().optional(),
});

const TextMeasurePaddingSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});

const NormalizedTextMeasureInputSchema = z.object({
  paragraphs: z.array(TextMeasureParagraphSchema).min(1),
  style: z.object({
    fontFamily: z.string().optional(),
    fontSizePt: z.number(),
    bold: z.boolean(),
    italic: z.boolean(),
    lineHeightMultiplier: z.number(),
    letterSpacingPt: z.number().optional(),
  }),
  box: z.object({
    widthInches: z.number(),
    heightInches: z.number().optional(),
    wrap: z.enum(['word', 'char', 'none']),
    padding: TextMeasurePaddingSchema,
    usableWidthInches: z.number(),
    usableHeightInches: z.number().optional(),
  }),
  sourceKind: z.enum(['generated', 'imported', 'ui-runtime']),
});

const NormalizedClusterAdvanceRequestSchema = z.object({
  clusters: z.array(z.string()),
  style: z.object({
    fontFamily: z.string().optional(),
    fontSizePt: z.number(),
    bold: z.boolean(),
    italic: z.boolean(),
    lineHeightMultiplier: z.number(),
    letterSpacingPt: z.number().optional(),
  }),
  sourceKind: z.enum(['generated', 'imported', 'ui-runtime']),
});

const TextMeasureLineSchema = z.object({
  text: z.string().optional(),
  widthInches: z.number(),
});

const TextMeasureResultSchema = z.object({
  lineCount: z.number(),
  contentHeightInches: z.number(),
  totalHeightInches: z.number(),
  maxLineWidthInches: z.number(),
  lines: z.array(TextMeasureLineSchema).optional(),
  usedFallback: z.boolean(),
  warnings: z.array(z.string()),
  fitsWidth: z.boolean().optional(),
  fitsHeight: z.boolean().optional(),
});

const MeasurementBatchErrorSchema = z.object({
  error: z.string(),
});

const ClusterAdvanceResultSchema = z.object({
  advances: z.array(z.number()),
});

export const MeasurementBatchRequestSchema = z.object({
  requestId: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  inputs: z.array(NormalizedTextMeasureInputSchema),
  clusterRequests: z.array(NormalizedClusterAdvanceRequestSchema).optional(),
});

export const MeasurementBatchResponseSchema = z.object({
  requestId: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  results: z.array(z.union([TextMeasureResultSchema, MeasurementBatchErrorSchema])),
  clusterResults: z.array(z.union([ClusterAdvanceResultSchema, MeasurementBatchErrorSchema])).optional(),
});

export const MeasurementWorkerReadyPayloadSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export type MeasurementBatchRequest = z.infer<typeof MeasurementBatchRequestSchema>;
export type MeasurementBatchResponse = z.infer<typeof MeasurementBatchResponseSchema>;
export type MeasurementWorkerReadyPayload = z.infer<typeof MeasurementWorkerReadyPayloadSchema>;
export type MeasurementBatchResult = TextMeasureResult | { error: string };
export type MeasurementClusterAdvanceResult = { advances: number[] } | { error: string };

export interface MeasurementWorkerBridge {
  setMeasureBatchHandler(
    handler: (request: MeasurementBatchRequest) => MeasurementBatchResponse | Promise<MeasurementBatchResponse>,
  ): void;
  notifyReady(): void;
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `measurement-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createMeasurementBatchRequest(
  inputs: readonly NormalizedTextMeasureInput[],
  requestId?: string,
): MeasurementBatchRequest;
export function createMeasurementBatchRequest(
  inputs: readonly NormalizedTextMeasureInput[],
  clusterRequests: readonly NormalizedClusterAdvanceRequest[],
  requestId?: string,
): MeasurementBatchRequest;
export function createMeasurementBatchRequest(
  inputs: readonly NormalizedTextMeasureInput[],
  clusterRequestsOrRequestId: readonly NormalizedClusterAdvanceRequest[] | string = [],
  requestId: string = createRequestId(),
): MeasurementBatchRequest {
  const clusterRequests = typeof clusterRequestsOrRequestId === 'string'
    ? []
    : clusterRequestsOrRequestId;
  const resolvedRequestId = typeof clusterRequestsOrRequestId === 'string'
    ? clusterRequestsOrRequestId
    : requestId;

  return {
    requestId: resolvedRequestId,
    protocolVersion: PROTOCOL_VERSION,
    inputs: [...inputs],
    ...(clusterRequests.length > 0
      ? {
          clusterRequests: clusterRequests.map((request) => ({
            clusters: [...request.clusters],
            style: { ...request.style },
            sourceKind: request.sourceKind,
          })),
        }
      : {}),
  };
}

export function createMeasurementBatchResponse(
  requestId: string,
  results: readonly MeasurementBatchResult[],
  clusterResults: readonly MeasurementClusterAdvanceResult[] = [],
): MeasurementBatchResponse {
  return {
    requestId,
    protocolVersion: PROTOCOL_VERSION,
    results: [...results],
    ...(clusterResults.length > 0 ? { clusterResults: [...clusterResults] } : {}),
  };
}

export function createMeasurementWorkerReadyPayload(): MeasurementWorkerReadyPayload {
  return {
    protocolVersion: PROTOCOL_VERSION,
  };
}

export function parseMeasurementBatchRequest(payload: unknown): MeasurementBatchRequest {
  return MeasurementBatchRequestSchema.parse(payload);
}

export function parseMeasurementBatchResponse(payload: unknown): MeasurementBatchResponse {
  return MeasurementBatchResponseSchema.parse(payload);
}

export function parseMeasurementWorkerReadyPayload(payload: unknown): MeasurementWorkerReadyPayload {
  return MeasurementWorkerReadyPayloadSchema.parse(payload);
}

export function isMeasurementBatchError(
  result: MeasurementBatchResult | MeasurementClusterAdvanceResult,
): result is { error: string } {
  return 'error' in result;
}

export type {
  NormalizedClusterAdvanceRequest,
  NormalizedTextMeasureInput,
  TextMeasureResult,
};
