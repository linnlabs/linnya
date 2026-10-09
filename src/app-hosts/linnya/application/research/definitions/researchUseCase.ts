import type { ResearchRunArgs, ResearchRunData } from '@app/schemas';
import type { PreparedResearchStage, ResearchExecutionIdentity, ResearchStageReceiptPort } from './researchStageReceipt';
import type { ResearchDocumentPort } from './researchDocumentPort';

export interface ResearchChildPort {
  execute(stage: PreparedResearchStage, identity: ResearchExecutionIdentity, signal?: AbortSignal): Promise<{
    readonly sourceRunId: string;
    readonly text: string;
  }>;
}
export interface ResearchUseCasePorts {
  readonly documents: ResearchDocumentPort;
  readonly receipts: ResearchStageReceiptPort;
  readonly children: ResearchChildPort;
}
export interface ResearchUseCase {
  execute(input: ResearchRunArgs, identity: ResearchExecutionIdentity, signal?: AbortSignal): Promise<ResearchRunData>;
}
