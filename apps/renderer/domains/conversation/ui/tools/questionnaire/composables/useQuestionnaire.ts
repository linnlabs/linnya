/**
 * @file apps/renderer/domains/conversation/ui/tools/questionnaire/composables/useQuestionnaire.ts
 * @description 问卷逻辑 composable（ask 工具）。
 *
 * 设计原则：
 * - **单向数据流**：UI 只驱动本地状态，提交/跳过走 Store 的统一入口；
 * - **严格类型**：不使用 any，不做随意断言，通过 type guard 逐步收敛；
 * - **统一协议**：原始 args/result/interaction 已在 admission projector 中转为 presentation。
 */

import { computed, reactive, ref, watch } from 'vue';
import { useAssistantStore } from '../../../../store/assistantStore';
import type { ConversationMessageResolver } from '../../../../definitions/conversationMessages';
import type { ToolCardPresentation } from '../../types';
import type {
  Answers,
  AskPresentationData,
  MultiAnswers,
  OtherAnswers,
  Question,
  QuestionnaireViewData,
  QuestionnaireStatus,
  TextAnswers,
  ValidationErrors,
} from '../definitions/questionnaire';
import { toggleMultiAnswerSelection } from '../functions/toggleMultiAnswerSelection';

function replaceStringRecord(target: Record<string, string>, source: Record<string, string>): void {
  Object.keys(target).forEach(key => delete target[key]);
  Object.entries(source).forEach(([key, value]) => {
    target[key] = value;
  });
}

function replaceStringArrayRecord(
  target: Record<string, string[]>,
  source: Record<string, string[]>
): void {
  Object.keys(target).forEach(key => delete target[key]);
  Object.entries(source).forEach(([key, value]) => {
    target[key] = [...value];
  });
}

export function useQuestionnaire(
  props: Readonly<{
    presentation: ToolCardPresentation<AskPresentationData>;
  }>,
  conversationMessage: ConversationMessageResolver
) {
  const assistantStore = useAssistantStore();

  // ===============================
  // 本地状态（高内聚）
  // ===============================
  const localAnswers = reactive<Answers>({});
  const localMultiAnswers = reactive<MultiAnswers>({});
  const localTextAnswers = reactive<TextAnswers>({});
  const localOtherAnswers = reactive<OtherAnswers>({});

  const isSubmitting = ref(false);
  const validationErrors = reactive<ValidationErrors>({});

  // ===============================
  // presentation 已在 live/reload admission 完成原始合同解析
  // ===============================
  const submitFallback = computed(() =>
    conversationMessage('conversation.tool.askQuestions.submitFallback')
  );
  const canonicalQuestionnaireData = computed(() =>
    props.presentation.data.questionnaire.kind === 'canonical'
      ? props.presentation.data.questionnaire.data
      : null
  );
  const questionnaireData = computed<QuestionnaireViewData>(() => {
    const questionnaire = props.presentation.data.questionnaire;
    if (questionnaire.kind === 'canonical') return questionnaire.data;
    if (questionnaire.kind === 'preview') {
      return {
        questionnaireId: null,
        title: questionnaire.data.title,
        description: questionnaire.data.description,
        allowSkip: true,
        submitLabel: questionnaire.data.submitLabel?.trim() || submitFallback.value,
        questions: questionnaire.data.questions,
      };
    }
    return {
      questionnaireId: null,
      allowSkip: true,
      submitLabel: submitFallback.value,
      questions: [],
    };
  });
  const canRespond = computed(
    () =>
      canonicalQuestionnaireData.value !== null &&
      props.presentation.data.interaction.type === 'active'
  );
  const emptyStateText = computed(() =>
    conversationMessage('conversation.tool.askQuestions.emptyText')
  );

  // ===============================
  // 问卷状态已由 projector 从正式 interaction 联合判别
  // ===============================
  const questionnaireStatus = computed<QuestionnaireStatus>(() => {
    const interaction = props.presentation.data.interaction;
    return interaction.type === 'pending' ? { type: 'active' } : interaction;
  });

  const isCompleted = computed(() => questionnaireStatus.value.type !== 'active');

  const submittedAnswers = computed(() => {
    if (questionnaireStatus.value.type !== 'submitted') return undefined;
    return questionnaireStatus.value.userAnswers;
  });

  // ===============================
  // 统一更新 API
  // ===============================
  const updateSingleAnswer = (questionId: string, value: string) => {
    if (isCompleted.value) return;
    localAnswers[questionId] = value;
    if (validationErrors[questionId]) delete validationErrors[questionId];
  };

  const updateMultiAnswer = (question: Question, optionId: string) => {
    if (isCompleted.value) return;
    const change = toggleMultiAnswerSelection(
      localMultiAnswers[question.id] ?? [],
      optionId,
      question.maxSelect
    );

    localMultiAnswers[question.id] = change.selection;
    if (change.rejectedByLimit && question.maxSelect !== undefined) {
      validationErrors[question.id] = conversationMessage(
        'conversation.tool.askQuestions.validation.maxSelect',
        { count: question.maxSelect }
      );
      return;
    }

    if (validationErrors[question.id]) delete validationErrors[question.id];
  };

  const updateTextAnswer = (questionId: string, value: string) => {
    if (isCompleted.value) return;
    localTextAnswers[questionId] = value;
    if (validationErrors[questionId]) delete validationErrors[questionId];
  };

  const updateOtherAnswer = (questionId: string, value: string) => {
    if (isCompleted.value) return;
    localOtherAnswers[questionId] = value;
  };

  // ===============================
  // 表单验证
  // ===============================
  const validateForm = (): boolean => {
    Object.keys(validationErrors).forEach(k => delete validationErrors[k]);
    let ok = true;

    questionnaireData.value.questions.forEach(q => {
      if (!q.required) return;

      if (q.type === 'single') {
        const ans = localAnswers[q.id];
        if (!ans) {
          validationErrors[q.id] = conversationMessage(
            'conversation.tool.askQuestions.validation.singleRequired'
          );
          ok = false;
          return;
        }
        if (ans === '__other__' && !localOtherAnswers[q.id]?.trim()) {
          validationErrors[q.id] = conversationMessage(
            'conversation.tool.askQuestions.validation.singleOtherRequired'
          );
          ok = false;
        }
        return;
      }

      if (q.type === 'multi') {
        const sel = localMultiAnswers[q.id] || [];
        if (sel.length === 0) {
          validationErrors[q.id] = conversationMessage(
            'conversation.tool.askQuestions.validation.multiRequired'
          );
          ok = false;
          return;
        }
        if (sel.includes('__other__') && !localOtherAnswers[q.id]?.trim()) {
          validationErrors[q.id] = conversationMessage(
            'conversation.tool.askQuestions.validation.multiOtherRequired'
          );
          ok = false;
          return;
        }
        if (q.maxSelect && sel.length > q.maxSelect) {
          validationErrors[q.id] = conversationMessage(
            'conversation.tool.askQuestions.validation.maxSelect',
            {
              count: q.maxSelect,
            }
          );
          ok = false;
        }
        return;
      }

      if (q.type === 'text') {
        if (!localTextAnswers[q.id]?.trim()) {
          validationErrors[q.id] = conversationMessage(
            'conversation.tool.askQuestions.validation.textRequired'
          );
          ok = false;
        }
      }
    });

    return ok;
  };

  const isFormValid = computed(() => {
    return questionnaireData.value.questions.every(q => {
      if (!q.required) return true;
      if (q.type === 'single') {
        const ans = localAnswers[q.id];
        if (!ans) return false;
        if (ans === '__other__') return !!localOtherAnswers[q.id]?.trim();
        return true;
      }
      if (q.type === 'multi') {
        const sel = localMultiAnswers[q.id];
        if (!sel || sel.length === 0) return false;
        if (sel.includes('__other__')) return !!localOtherAnswers[q.id]?.trim();
        return true;
      }
      if (q.type === 'text') return !!localTextAnswers[q.id]?.trim();
      return true;
    });
  });

  // ===============================
  // 提交/跳过：通过 Store 统一结束交互
  // ===============================
  const compileAnswersToText = (questionnaireId: string): string => {
    const qid = questionnaireId;
    let t = `问卷(ID: ${qid}) 回答：\n\n`;
    questionnaireData.value.questions.forEach((q, i) => {
      t += `${i + 1}) ${q.question}\n`;
      if (q.type === 'single') {
        const selectedId = localAnswers[q.id];
        if (selectedId === '__other__') {
          t += `   答案: 其他 - ${localOtherAnswers[q.id] || '未填写'}\n\n`;
          return;
        }
        const option = q.options?.find(opt => opt.id === selectedId);
        t += `   答案: ${option?.label || '未选择'}\n\n`;
        return;
      }
      if (q.type === 'multi') {
        const selectedIds = localMultiAnswers[q.id] || [];
        if (selectedIds.length === 0) {
          t += `   答案: 未选择\n\n`;
          return;
        }
        const labels = selectedIds.map(id => {
          if (id === '__other__') return `其他 - ${localOtherAnswers[q.id] || '未填写'}`;
          const option = q.options?.find(opt => opt.id === id);
          return option?.label || id;
        });
        t += `   答案: ${labels.join(', ')}\n\n`;
        return;
      }
      if (q.type === 'text') {
        t += `   答案: ${localTextAnswers[q.id] || '未填写'}\n\n`;
      }
    });
    return t;
  };

  const compileAnswersToObject = (): Record<string, unknown> => {
    return {
      answers: { ...localAnswers },
      multiAnswers: { ...localMultiAnswers },
      textAnswers: { ...localTextAnswers },
      otherAnswers: { ...localOtherAnswers },
    };
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    const canonicalQuestionnaire = canonicalQuestionnaireData.value;
    if (!canonicalQuestionnaire) {
      // 正式问卷事实或 tool_call_id 缺失时不能恢复执行，UI 不补造身份。
      validationErrors['__global__'] = conversationMessage(
        'conversation.tool.askQuestions.validation.submitMissingToolCall'
      );
      return;
    }

    isSubmitting.value = true;
    try {
      const answersText = compileAnswersToText(canonicalQuestionnaire.questionnaireId);
      const answersPayload = compileAnswersToObject();
      await assistantStore.concludeAskQuestionsInteraction({
        observation: answersText,
        isSkipped: false,
        answersPayload,
        toolCallId: props.presentation.data.toolCallId,
        toolName: props.presentation.data.toolName,
      });
    } finally {
      isSubmitting.value = false;
    }
  };

  const handleSkip = async () => {
    const canonicalQuestionnaire = canonicalQuestionnaireData.value;
    if (!canonicalQuestionnaire) {
      validationErrors['__global__'] = conversationMessage(
        'conversation.tool.askQuestions.validation.actionMissingToolCall'
      );
      return;
    }

    isSubmitting.value = true;
    try {
      const qid = canonicalQuestionnaire.questionnaireId;
      const skipText = `问卷(ID: ${qid}) - 用户选择跳过回答。请继续提供帮助。`;
      await assistantStore.concludeAskQuestionsInteraction({
        observation: skipText,
        isSkipped: true,
        toolCallId: props.presentation.data.toolCallId,
        toolName: props.presentation.data.toolName,
      });
    } finally {
      isSubmitting.value = false;
    }
  };

  // ===============================
  // 初始化：按题型填充空值，确保 v-model/渲染稳定
  // ===============================
  const questionsSignature = computed(() => {
    const qs = questionnaireData.value.questions;
    return JSON.stringify(qs.map(q => ({ id: q.id, type: q.type })));
  });

  watch(
    () => [
      questionsSignature.value,
      questionnaireStatus.value.type,
      questionnaireStatus.value.type === 'submitted'
        ? questionnaireStatus.value.userAnswers
        : undefined,
    ],
    () => {
      if (questionnaireStatus.value.type === 'submitted') {
        const payload = submittedAnswers.value;
        if (payload) {
          // terminal interaction 来自 durable row 的 admission presentation；重挂载必须从该事实恢复选择。
          replaceStringRecord(localAnswers, payload.answers);
          replaceStringArrayRecord(localMultiAnswers, payload.multiAnswers);
          replaceStringRecord(localTextAnswers, payload.textAnswers);
          replaceStringRecord(localOtherAnswers, payload.otherAnswers);
        }
        return;
      }

      // 已完成时不再初始化，保持展示（由外部 metadata 控制）
      if (isCompleted.value) return;

      questionnaireData.value.questions.forEach(q => {
        if (q.type === 'single' && !(q.id in localAnswers)) localAnswers[q.id] = '';
        if (q.type === 'multi' && !(q.id in localMultiAnswers)) localMultiAnswers[q.id] = [];
        if (q.type === 'text' && !(q.id in localTextAnswers)) localTextAnswers[q.id] = '';
        if (q.allowOther && !(q.id in localOtherAnswers)) localOtherAnswers[q.id] = '';
      });
    },
    { immediate: true }
  );

  // ===============================
  // 键盘事件
  // ===============================
  const handleKeyDown = (event: KeyboardEvent) => {
    if (isCompleted.value) return;
    if (event.key === 'Escape' && !isSubmitting.value) {
      event.preventDefault();
      handleSkip();
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === 'Enter' &&
      isFormValid.value &&
      canRespond.value &&
      !isSubmitting.value
    ) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return {
    isSubmitting,
    validationErrors,
    isFormValid,
    questionnaireData,
    questionnaireStatus,
    isCompleted,
    canRespond,
    emptyStateText,

    answers: computed(() => localAnswers),
    multiAnswers: computed(() => localMultiAnswers),
    textAnswers: computed(() => localTextAnswers),
    otherAnswers: computed(() => localOtherAnswers),

    updateSingleAnswer,
    updateMultiAnswer,
    updateTextAnswer,
    updateOtherAnswer,

    handleSubmit,
    handleSkip,
    handleKeyDown,
  };
}
