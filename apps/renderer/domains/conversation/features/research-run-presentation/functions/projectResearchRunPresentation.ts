import {
  ResearchRunArgsSchema,
  ResearchRunStructuredResultSchema,
  type ResearchChildArtifact,
  type ResearchStage,
} from '@app/schemas';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';
import {
  createConversationToolLocalizedTextDescriptor,
  createConversationToolTitleDescriptor,
} from '../../../ui/tools/functions/createConversationToolTitleDescriptor';
import type {
  ToolCompactStepPresentation,
  ToolCompactStepProjectorInput,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../../ui/tools/types';
import type {
  ResearchRunPresentationData,
  ResearchRunProgressItem,
} from '../definitions/researchRunPresentation';

const STAGE_LABELS: Record<ResearchStage, ConversationMessageKey> = {
  investigation: 'conversation.tool.researchRun.investigation',
  investigation_review: 'conversation.tool.researchRun.investigationReview',
  draft: 'conversation.tool.researchRun.draft',
  argument_review: 'conversation.tool.researchRun.argumentReview',
  source_review: 'conversation.tool.researchRun.sourceReview',
  revision: 'conversation.tool.researchRun.revision',
};

function requireResearchIdentity(input: { sourceToolName: string; uiKey: string }): void {
  if (input.sourceToolName !== 'research_run' || input.uiKey !== 'research_run') {
    throw new Error('Unsupported research run presentation identity');
  }
}

function buildProgressItems(
  knownIds: readonly string[],
  artifacts: readonly ResearchChildArtifact[],
): ResearchRunProgressItem[] {
  const artifactsById = new Map(artifacts.map(artifact => [artifact.subrun_id, artifact]));
  // 保存结果给出正式阶段顺序；没有保存结果的真实 child 仍保留 trace，但不猜阶段或终态。
  const ids = [...artifacts.map(artifact => artifact.subrun_id), ...knownIds.filter(id => !artifactsById.has(id))];
  return ids.map(subrunId => {
    const artifact = artifactsById.get(subrunId);
    return {
      subrunId,
      label: createConversationToolLocalizedTextDescriptor(
        artifact ? STAGE_LABELS[artifact.stage] : 'conversation.tool.researchRun.process',
      ),
      ...(artifact ? { artifactPath: artifact.path } : {}),
    };
  });
}

export function projectResearchRunPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ResearchRunPresentationData> {
  requireResearchIdentity(input);
  const knownIds = input.subrunSummary?.subrun_ids ?? [];
  // 错误和早期 lifecycle 不冒充成功 payload；参数校验错误也应有可见失败标题。
  if (input.status !== 'success') {
    return {
      title: createConversationToolTitleDescriptor(input.status === 'error'
        ? 'conversation.tool.researchRun.failed' : 'conversation.tool.researchRun.title'),
      data: { kind: 'lifecycle', items: buildProgressItems(knownIds, []) },
    };
  }
  ResearchRunArgsSchema.parse(input.args);
  const result = ResearchRunStructuredResultSchema.parse(input.result);
  return {
    title: createConversationToolTitleDescriptor(result.data.status === 'delivered'
      ? 'conversation.tool.researchRun.delivered' : 'conversation.tool.researchRun.inputsChanged'),
    data: {
      kind: 'result',
      outcome: result.data.status,
      modelId: result.data.model_id,
      changedPaths: result.data.status === 'inputs_changed' ? result.data.changed_paths : [],
      items: buildProgressItems(knownIds, result.data.artifacts),
    },
  };
}

export function projectResearchRunCompactStep(
  input: ToolCompactStepProjectorInput,
): ToolCompactStepPresentation {
  requireResearchIdentity(input);
  if (input.status !== 'success') {
    return { title: createConversationToolLocalizedTextDescriptor(input.status === 'error'
      ? 'conversation.tool.researchRun.failed' : 'conversation.tool.researchRun.title') };
  }
  ResearchRunArgsSchema.parse(input.args);
  const result = ResearchRunStructuredResultSchema.parse(input.result);
  return { title: createConversationToolLocalizedTextDescriptor(result.data.status === 'delivered'
    ? 'conversation.tool.researchRun.delivered' : 'conversation.tool.researchRun.inputsChanged') };
}
