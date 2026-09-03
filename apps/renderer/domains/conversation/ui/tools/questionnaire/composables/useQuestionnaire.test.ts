import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { CONVERSATION_MESSAGE_FALLBACKS } from '../../../../definitions/conversationMessageCatalog';
import type { ConversationMessageResolver } from '../../../../definitions/conversationMessages';
import type { ToolCardPresentation } from '../../types';
import type {
  AskPresentationData,
  AskPresentationInteraction,
  AskPresentationQuestionnaire,
} from '../definitions/questionnaire';

const concludeAskQuestionsInteractionMock = vi.fn();

vi.mock('../../../../store/assistantStore', () => ({
  useAssistantStore: () => ({
    concludeAskQuestionsInteraction: concludeAskQuestionsInteractionMock,
  }),
}));

import { useQuestionnaire } from './useQuestionnaire';

const testConversationMessage: ConversationMessageResolver = (key, params) => {
  let text: string = CONVERSATION_MESSAGE_FALLBACKS[key];
  if (!params) return text;
  Object.entries(params).forEach(([paramKey, value]) => {
    text = text.replace(`{${paramKey}}`, String(value));
  });
  return text;
};

function props(
  questionnaire: AskPresentationQuestionnaire,
  interaction: AskPresentationInteraction = { type: 'pending' }
): { presentation: ToolCardPresentation<AskPresentationData> } {
  const isWaitingForUser = questionnaire.kind === 'canonical' && interaction.type === 'active';
  return {
    presentation: {
      uiKey: 'ask',
      status: questionnaire.kind === 'canonical' && !isWaitingForUser ? 'success' : 'loading',
      phase: questionnaire.kind === 'canonical' && !isWaitingForUser ? 'complete' : 'update',
      data: {
        toolCallId: 'call_1',
        questionnaire,
        toolName: 'ask',
        interaction,
      },
    },
  };
}

const canonicalQuestionnaire = {
  kind: 'canonical' as const,
  data: {
    questionnaireId: 'qn_1',
    title: '工具测试问卷',
    description: '用于验证统一交互协议',
    allowSkip: true,
    submitLabel: '提交',
    questions: [
      {
        id: 'q_1',
        type: 'text' as const,
        question: '请输入主题',
        required: true,
      },
    ],
  },
};

const multiQuestion = {
  id: 'q_multi',
  type: 'multi' as const,
  question: '请选择交付格式',
  options: [
    { id: 'a', label: '文档' },
    { id: 'b', label: '演示稿' },
    { id: 'c', label: '表格' },
  ],
  required: true,
  maxSelect: 2,
};

const canonicalMultiQuestionnaire = {
  kind: 'canonical' as const,
  data: {
    questionnaireId: 'qn_multi',
    allowSkip: true,
    submitLabel: '提交',
    questions: [multiQuestion],
  },
};

describe('useQuestionnaire', () => {
  beforeEach(() => {
    concludeAskQuestionsInteractionMock.mockReset();
  });

  it('active 正式问卷可回答并通过统一 orchestration 提交', async () => {
    const questionnaire = useQuestionnaire(
      props(canonicalQuestionnaire, { type: 'active' }),
      testConversationMessage
    );
    await nextTick();

    expect(questionnaire.canRespond.value).toBe(true);
    questionnaire.updateTextAnswer('q_1', '演示主题');
    await questionnaire.handleSubmit();

    expect(concludeAskQuestionsInteractionMock).toHaveBeenCalledWith({
      observation: expect.stringContaining('演示主题'),
      isSkipped: false,
      answersPayload: {
        answers: {},
        multiAnswers: {},
        textAnswers: { q_1: '演示主题' },
        otherAnswers: {},
      },
      toolCallId: 'call_1',
      toolName: 'ask',
    });
  });

  it('active 多选问卷连续选择后提交完整答案', async () => {
    const questionnaire = useQuestionnaire(
      props(canonicalMultiQuestionnaire, { type: 'active' }),
      testConversationMessage
    );
    await nextTick();

    questionnaire.updateMultiAnswer(multiQuestion, 'a');
    questionnaire.updateMultiAnswer(multiQuestion, 'b');
    await questionnaire.handleSubmit();

    expect(concludeAskQuestionsInteractionMock).toHaveBeenCalledWith({
      observation: expect.stringContaining('文档, 演示稿'),
      isSkipped: false,
      answersPayload: {
        answers: {},
        multiAnswers: { q_multi: ['a', 'b'] },
        textAnswers: {},
        otherAnswers: {},
      },
      toolCallId: 'call_1',
      toolName: 'ask',
    });
  });

  it('多选达到上限后保留已有答案并提示用户', async () => {
    const questionnaire = useQuestionnaire(
      props(canonicalMultiQuestionnaire, { type: 'active' }),
      testConversationMessage
    );
    await nextTick();

    questionnaire.updateMultiAnswer(multiQuestion, 'a');
    questionnaire.updateMultiAnswer(multiQuestion, 'b');
    questionnaire.updateMultiAnswer(multiQuestion, 'c');

    expect(questionnaire.multiAnswers.value).toEqual({ q_multi: ['a', 'b'] });
    expect(questionnaire.validationErrors.q_multi).toBe('最多可选 2 项');
  });

  it('参数预览可展示但没有正式 questionnaireId 时不可恢复执行', async () => {
    const questionnaire = useQuestionnaire(
      props({
        kind: 'preview',
        data: {
          questions: [{ id: 'q_preview', type: 'text', question: '预览问题' }],
        },
      }),
      testConversationMessage
    );
    await nextTick();

    expect(questionnaire.questionnaireData.value).toMatchObject({
      questionnaireId: null,
      questions: [{ id: 'q_preview', type: 'text', question: '预览问题' }],
    });
    expect(questionnaire.canRespond.value).toBe(false);
    await questionnaire.handleSkip();
    expect(concludeAskQuestionsInteractionMock).not.toHaveBeenCalled();
  });

  it('submitted presentation 在重挂载后恢复已提交答案', async () => {
    const questionnaire = useQuestionnaire(
      props(canonicalQuestionnaire, {
        type: 'submitted',
        timestamp: 123,
        userAnswers: {
          answers: {},
          multiAnswers: {},
          textAnswers: { q_1: '已经提交的文本' },
          otherAnswers: {},
        },
      }),
      testConversationMessage
    );
    await nextTick();

    expect(questionnaire.isCompleted.value).toBe(true);
    expect(questionnaire.textAnswers.value).toEqual({ q_1: '已经提交的文本' });
    expect(questionnaire.questionnaireStatus.value).toEqual({
      type: 'submitted',
      timestamp: 123,
      userAnswers: {
        answers: {},
        multiAnswers: {},
        textAnswers: { q_1: '已经提交的文本' },
        otherAnswers: {},
      },
    });
  });
});
