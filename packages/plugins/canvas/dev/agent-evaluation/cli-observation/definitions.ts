import type { BackendPluginCliContribution, BackendPluginCliExecutionContext, BackendPluginCliResult } from '@plugin/backend/pluginCli';
import type { z } from 'zod';
import type { CanvasCliObservationActivationSchema, CanvasCliObservationSessionSchema } from './definitions/sealedObservation';

export type Missing = { readonly state: 'absent' | 'ambiguous' | 'not-applicable'; readonly value: null };
export interface CanvasCliRequestIdentity {
  readonly requestId: { readonly state: 'explicit'; readonly value: string } | Missing;
  readonly dryRun: { readonly state: 'explicit'; readonly value: true } | { readonly state: 'absent'; readonly value: false }
    | { readonly state: 'ambiguous' | 'not-applicable'; readonly value: null };
}

export type CliPreparationInput = Parameters<BackendPluginCliContribution['prepare']>[0];

/** 这里只保存公开执行身份；hostContext、signal 和环境变量不进入证据。 */
export interface CanvasCliExecutionIdentity {
  readonly conversationId: string | null;
  readonly agentRunId: string | null;
  readonly projectId: string | null;
}

export interface CanvasCliObservationProvenance {
  readonly observationSourceRevision: string;
  readonly productionSourceRevision: string;
  readonly originalBackendSha256: string;
  readonly payloadManifestSha256: string;
}

export interface CanvasCliObservationBuild extends CanvasCliObservationProvenance {
  readonly evidenceDirectory: string;
}

export interface CanvasCliObservationPreparation {
  readonly productionPluginDirectory: string;
  readonly outputDirectory: string;
  readonly evidenceDirectory: string;
  readonly productionSourceRevision: string;
  readonly observationSourceRevision: string;
}

export interface CanvasCliObservation {
  start(input: CliPreparationInput): number;
  ready(id: number): void;
  execute(id: number, context: BackendPluginCliExecutionContext): void;
  result(id: number, stage: 'prepare' | 'execute', result: BackendPluginCliResult): void;
  threw(id: number, stage: 'prepare' | 'execute'): void;
  seal(exitCode?: number): void;
}

export interface CanvasObservedCliInput extends CanvasCliRequestIdentity {
  readonly invocationId: string; readonly command: string | null; readonly locator: string | null;
  readonly managedOpsPath: string | null; readonly opsPathOutsideConversation: boolean;
}
export interface CanvasObservedCliInvocation {
  readonly origin: 'backend-cli-observation'; readonly recordingId: number; readonly invocationId: string;
  readonly input: CanvasObservedCliInput; readonly preparedAt: number; readonly startedAt: number | null; readonly finishedAt: number;
  readonly stage: 'prepare' | 'execute'; readonly identity: CanvasCliExecutionIdentity | null;
  readonly result: BackendPluginCliResult | null; readonly threw: boolean; readonly sourceFiles: readonly string[];
}
export interface CanvasSealedCliObservation {
  readonly activation: z.infer<typeof CanvasCliObservationActivationSchema>;
  readonly session: z.infer<typeof CanvasCliObservationSessionSchema>;
  readonly finishedAt: number; readonly invocations: readonly CanvasObservedCliInvocation[]; readonly evidenceFiles: readonly string[];
  readonly producerContract: 'source61-fresh-committed-null-iff-no-arrange';
}
