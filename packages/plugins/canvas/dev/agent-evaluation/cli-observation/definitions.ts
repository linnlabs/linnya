import type { BackendPluginCliContribution, BackendPluginCliExecutionContext, BackendPluginCliResult } from '@plugin/backend/pluginCli';

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

export interface CanvasCliObservation {
  start(input: CliPreparationInput): number;
  ready(id: number): void;
  execute(id: number, context: BackendPluginCliExecutionContext): void;
  result(id: number, stage: 'prepare' | 'execute', result: BackendPluginCliResult): void;
  threw(id: number, stage: 'prepare' | 'execute'): void;
  seal(exitCode?: number): void;
}
