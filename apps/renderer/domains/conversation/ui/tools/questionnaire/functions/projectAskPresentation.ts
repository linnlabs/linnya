import {
  AskInputSchema,
  AskPlaceholderArgsSchema,
  QuestionnaireDataSchema,
  QuestionnaireAnswersSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import type {
  AskPresentationData,
  AskPresentationInteraction,
  AskPresentationQuestionnaire,
} from '../definitions/questionnaire';

function projectInteraction(input: ToolPresentationProjectorInput): AskPresentationInteraction {
  const interaction = input.interaction;
  if (!interaction) return { type: 'pending' };
  if (interaction.status === 'active') return { type: 'active' };
  if (interaction.status === 'skipped') {
    return {
      type: 'skipped',
      ...(interaction.submittedAt === undefined ? {} : { timestamp: interaction.submittedAt }),
    };
  }
  if (interaction.status === 'submitted') {
    return {
      type: 'submitted',
      ...(interaction.submittedAt === undefined ? {} : { timestamp: interaction.submittedAt }),
      userAnswers: QuestionnaireAnswersSchema.parse(interaction.response),
    };
  }
  throw new Error(`Unsupported ask interaction status: ${interaction.status}`);
}

function projectQuestionnaire(input: ToolPresentationProjectorInput): AskPresentationQuestionnaire {
  if (input.interaction?.status === 'active') {
    return projectCanonicalQuestionnaire(input);
  }

  if (input.status !== 'success') {
    const placeholder = AskPlaceholderArgsSchema.safeParse(input.args);
    if (placeholder.success) return { kind: 'placeholder' };
    const preview = AskInputSchema.safeParse(input.args);
    if (preview.success) return { kind: 'preview', data: preview.data };
    // 模型参数仍处于未接纳生命周期；不把坏参数当成正式问卷。
    return { kind: 'placeholder' };
  }

  return projectCanonicalQuestionnaire(input);
}

function projectCanonicalQuestionnaire(
  input: ToolPresentationProjectorInput
): AskPresentationQuestionnaire {
  AskInputSchema.parse(input.args);

  const result = input.result;
  if (
    typeof result !== 'object' ||
    result === null ||
    Array.isArray(result) ||
    !('data' in result)
  ) {
    throw new Error('ask canonical presentation requires result.data');
  }
  return { kind: 'canonical', data: QuestionnaireDataSchema.parse(result.data) };
}

export function projectAskPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<AskPresentationData> {
  if (
    input.sourceToolName !== input.uiKey ||
    (input.uiKey !== 'ask' && input.uiKey !== 'ask_questions')
  ) {
    throw new Error(
      `Unsupported ask presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
    );
  }
  if (!input.toolCallId?.trim()) {
    throw new Error('ask presentation requires toolCallId.');
  }

  return {
    data: {
      toolCallId: input.toolCallId,
      toolName: input.uiKey,
      questionnaire: projectQuestionnaire(input),
      interaction: projectInteraction(input),
    },
  };
}
