import type { ResearchRunArgs, ResearchStage } from '@app/schemas';
import type { ResearchDocumentBinding } from './researchDocumentPort';
import type { PreparedResearchStageRequest } from './researchStageRequest';

export interface ResearchExecutionIdentity {
  readonly parentRunId: string;
  readonly toolCallId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly modelId: string;
}
export interface PreparedResearchStage {
  readonly stage: ResearchStage;
  readonly invocation: ResearchRunArgs;
  readonly subrunId: string;
  readonly request: PreparedResearchStageRequest;
  readonly inputs: readonly ResearchDocumentBinding[];
  readonly outputPath: string;
  /** 主模型显式委派参数；旧 Host 已接纳阶段没有此字段，恢复仍消费原请求。 */
  readonly delegation?: { readonly instructions: string; readonly documents: readonly string[] };
}
export interface ResearchStageReceipt extends PreparedResearchStage {
  readonly artifact?: ResearchDocumentBinding;
}
/** 仅保存业务交接，不复制 RunSupervisor 的运行中/取消/失败状态。 */
export interface ResearchStageReceiptPort {
  list(identity: ResearchExecutionIdentity): readonly ResearchStageReceipt[];
  prepare(identity: ResearchExecutionIdentity, input: PreparedResearchStage): ResearchStageReceipt;
  assertPrepared(identity: ResearchExecutionIdentity, input: PreparedResearchStage): void;
  /** 必须在正式文档创建的同一事务内调用。 */
  commitArtifact(
    identity: ResearchExecutionIdentity,
    input: PreparedResearchStage,
    artifact: ResearchDocumentBinding
  ): void;
}
