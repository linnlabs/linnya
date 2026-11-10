import { z } from 'zod';
import { CanvasVisualSamplingSchema } from './visualSampling';
const bounds = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export const MapLabelPlacementEvidenceSchema = z.object({
  qualification: z.literal('full-kernel-system-font-map-placement'),
  sampling: CanvasVisualSamplingSchema.extend({ mapCanvasDensity: z.literal(1), referenceCanvasDensity: z.literal(1) }),
  camera: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  candidates: z.array(z.object({ id: z.string(), title: z.string(), column: z.number().int(), bounds })),
  expectedIds: z.array(z.string()),
  stats: z.object({ renders: z.number(), bitmaps: z.number(), rasterCards: z.number(), identityActiveLabels: z.number(), sceneTransitions: z.number(), cameraTransition: z.boolean() }),
  missingColumn: z.number().int(), missingColumnImage: z.string(), rawKernelImage: z.string(),
});
export type MapLabelPlacementEvidence = z.infer<typeof MapLabelPlacementEvidenceSchema>;

export const DocumentMapMetadataEvidenceSchema = z.object({
  before: z.string(), after: z.string(), dpr: z.number().positive(), sampling: CanvasVisualSamplingSchema,
  revealedRegion: bounds, unchangedRegion: bounds,
  renders: z.object({ before: z.number(), after: z.number(), duplicate: z.number() }),
});
