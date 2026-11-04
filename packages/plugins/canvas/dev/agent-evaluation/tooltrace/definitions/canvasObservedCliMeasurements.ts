import { z } from 'zod';
import type { CanvasCommitResult, CanvasLayoutComputation } from '@plugin/canvas/shared';

export const CanvasObservedCliMeasurementLabelSchema = z.object({ origin: z.literal('backend-cli-observation'),
  performanceQualification: z.literal('observed-task-conservative-latency-only'),
  observationSourceRevision: z.string().regex(/^[a-f0-9]{40}$/), originalBackendSha256: z.string().regex(/^[a-f0-9]{64}$/),
  wrapperSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export interface CanvasObservedLayoutSample {
  readonly origin: 'backend-cli-observation'; readonly invocationId: string; readonly recordingId: number;
  readonly runId: string; readonly commitSequence: number; readonly computation: CanvasLayoutComputation; readonly sourceFiles: readonly string[];
}
export interface CanvasObservedCliMeasurements {
  readonly label: z.infer<typeof CanvasObservedCliMeasurementLabelSchema>;
  readonly commits: readonly CanvasCommitResult[]; readonly layoutComputations: readonly CanvasObservedLayoutSample[];
  readonly commitSources: readonly { readonly origin: 'backend-cli-observation'; readonly requestId: string; readonly sequence: number;
    readonly invocationId: string; readonly recordingId: number; readonly runId: string; readonly sourceFiles: readonly string[] }[];
  readonly freshWithoutLayout: readonly { readonly origin: 'backend-cli-observation'; readonly requestId: string; readonly invocationId: string;
    readonly runId: string; readonly sourceFiles: readonly string[] }[];
  readonly excluded: readonly { readonly invocationId: string; readonly reason: string; readonly sourceFiles: readonly string[] }[];
  readonly diagnostics: readonly string[]; readonly evidenceFiles: readonly string[];
}
