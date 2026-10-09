import type { ResearchRunArgs, ResearchRunArtifact, ResearchRunData } from '@app/schemas';
import type { ToolOwnerResultCommit } from '../../run-resumption';
import type {
  PreparedResearchStage,
  ResearchExecutionIdentity,
  ResearchStageReceiptPort,
} from './researchStageReceipt';
import type { ResearchDocumentPort } from './researchDocumentPort';

export type ResearchStageSubmission = (request: {
  readonly sourceRunId: string;
  readonly content: string;
  readonly signal?: AbortSignal;
  readonly resultCommit: ToolOwnerResultCommit<ResearchRunArtifact>;
}) => Promise<ResearchRunArtifact>;

export class ResearchInputsChangedError extends Error {
  constructor(readonly paths: readonly string[]) {
    super('Research inputs changed');
  }
}

export interface ResearchChildPort {
  execute(
    stage: PreparedResearchStage,
    identity: ResearchExecutionIdentity,
    submit: ResearchStageSubmission,
    signal?: AbortSignal
  ): Promise<ResearchRunArtifact>;
}
export interface ResearchUseCasePorts {
  readonly documents: ResearchDocumentPort;
  readonly receipts: ResearchStageReceiptPort;
  readonly children: ResearchChildPort;
}
export interface ResearchUseCase {
  execute(
    input: ResearchRunArgs,
    identity: ResearchExecutionIdentity,
    signal?: AbortSignal
  ): Promise<ResearchRunData>;
}
