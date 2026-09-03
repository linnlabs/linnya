import { computed, ref, watch, type Ref } from 'vue';
import { concludeInteractiveToolInteraction } from '@plugin/renderer/interactiveTool';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { SlidesPlanPresentationData } from '../definitions/slidesToolPresentation';
import type { SlidesToolCardMessageResolver } from '../definitions/slidesToolCardMessageCatalog';
import {
  arePptPlansEqual,
  buildApproveSubmission,
  buildModifySubmission,
  createBlankEditablePptPlanPage,
  createEditablePptPlanData,
  deleteEditablePptPlanPage,
  insertEditablePptPlanPage,
  moveEditablePptPlanPage,
  restoreDeletedEditablePptPlanPage,
  toPptPlanData,
  type DeletedEditablePptPlanPage,
  type EditablePptPlanData,
  type PptPlanData,
} from './pptPlanInteraction';

export interface PptPlanCardProps {
  presentation: ToolCardPresentation<SlidesPlanPresentationData>;
  messageId: string;
}

export function usePptPlanInteraction(
  props: PptPlanCardProps | Ref<PptPlanCardProps>,
  message: SlidesToolCardMessageResolver,
) {
  const resolvedProps = computed(() => ('value' in props ? props.value : props));

  const sourcePlan = computed(() => {
    const data = resolvedProps.value.presentation.data;
    return data.interaction.modifiedPlan ?? data.plan;
  });
  const interactionStatus = computed(() => resolvedProps.value.presentation.data.interaction);
  const editablePlan = ref<EditablePptPlanData | null>(null);
  const notes = ref('');
  const isSubmitting = ref(false);
  const submissionFailed = ref(false);
  const deletedPage = ref<DeletedEditablePptPlanPage | null>(null);
  const nextLocalPageId = ref(0);

  function createLocalPageId(): string {
    nextLocalPageId.value += 1;
    return `ppt-plan-page-${resolvedProps.value.messageId}-${nextLocalPageId.value}`;
  }

  watch(
    () => [sourcePlan.value, interactionStatus.value.status, interactionStatus.value.notes] as const,
    ([plan, , interactionNotes]) => {
      if (!plan) return;
      nextLocalPageId.value = 0;
      editablePlan.value = createEditablePptPlanData(plan, (page, index) => {
        return `ppt-plan-source-${resolvedProps.value.messageId}-${page.slideNumber}-${index}`;
      });
      notes.value = interactionNotes ?? '';
      submissionFailed.value = false;
      deletedPage.value = null;
    },
    { immediate: true },
  );

  const isCompleted = computed(() => interactionStatus.value.status !== 'active');
  const errorText = computed(() => (
    submissionFailed.value ? message('slides.plan.error.submitFailed') : null
  ));
  const normalizedEditablePlan = computed(() => {
    return editablePlan.value ? toPptPlanData(editablePlan.value) : null;
  });
  const validationErrorText = computed(() => {
    const plan = editablePlan.value;
    if (!plan) return null;
    if (plan.title.trim().length === 0) return message('slides.plan.validation.title');
    const visualDirectionValues = Object.values(plan.visualDirection);
    if (visualDirectionValues.some((value) => value.trim().length === 0)) {
      return message('slides.plan.validation.visualDirection');
    }
    const hasEmptyPage = plan.pages.some((page) => page.title.trim().length === 0 || page.content.trim().length === 0);
    return hasEmptyPage ? message('slides.plan.validation.pages') : null;
  });
  const isDirty = computed(() => {
    const trimmedNotes = notes.value.trim();
    return !arePptPlansEqual(sourcePlan.value, normalizedEditablePlan.value) || trimmedNotes.length > 0;
  });

  const canApprove = computed(() => {
    return !isCompleted.value && !isDirty.value && !!sourcePlan.value;
  });

  const canSubmitModify = computed(() => {
    return !isCompleted.value && !!editablePlan.value && isDirty.value && !validationErrorText.value;
  });

  function insertPageAt(index: number): string | null {
    if (isCompleted.value || !editablePlan.value) return null;
    const localId = createLocalPageId();
    editablePlan.value = insertEditablePptPlanPage(editablePlan.value, index, createBlankEditablePptPlanPage(localId));
    deletedPage.value = null;
    return localId;
  }

  function deletePage(localId: string): void {
    if (isCompleted.value || !editablePlan.value) return;
    const result = deleteEditablePptPlanPage(editablePlan.value, localId);
    editablePlan.value = result.plan;
    deletedPage.value = result.deleted;
  }

  function undoLastDelete(): void {
    if (isCompleted.value || !editablePlan.value || !deletedPage.value) return;
    editablePlan.value = restoreDeletedEditablePptPlanPage(editablePlan.value, deletedPage.value);
    deletedPage.value = null;
  }

  function movePage(localId: string, insertIndex: number): void {
    if (isCompleted.value || !editablePlan.value) return;
    editablePlan.value = moveEditablePptPlanPage(editablePlan.value, localId, insertIndex);
    deletedPage.value = null;
  }

  function normalizeForSubmission(): PptPlanData | null {
    return editablePlan.value ? toPptPlanData(editablePlan.value) : null;
  }

  const handleApprove = async () => {
    if (!canApprove.value) return;
    submissionFailed.value = false;
    isSubmitting.value = true;
    try {
      const submission = buildApproveSubmission();
      await concludeInteractiveToolInteraction({
        observation: submission.observation,
        data: submission.data,
        toolCallId: resolvedProps.value.presentation.data.toolCallId,
        toolName: 'ppt_plan',
        interactionResponse: submission.interactionResponse,
      });
    } catch (error) {
      submissionFailed.value = true;
      console.error('[Slides/PptPlan] 批准大纲失败', {
        toolCallId: resolvedProps.value.presentation.data.toolCallId,
        error,
      });
    } finally {
      isSubmitting.value = false;
    }
  };

  const handleSubmitModify = async () => {
    const plan = normalizeForSubmission();
    if (!canSubmitModify.value || !plan) return;
    submissionFailed.value = false;
    isSubmitting.value = true;
    try {
      const submission = buildModifySubmission(plan, notes.value.trim());
      await concludeInteractiveToolInteraction({
        observation: submission.observation,
        data: submission.data,
        toolCallId: resolvedProps.value.presentation.data.toolCallId,
        toolName: 'ppt_plan',
        interactionResponse: submission.interactionResponse,
      });
      deletedPage.value = null;
    } catch (error) {
      submissionFailed.value = true;
      console.error('[Slides/PptPlan] 提交大纲修改失败', {
        toolCallId: resolvedProps.value.presentation.data.toolCallId,
        error,
      });
    } finally {
      isSubmitting.value = false;
    }
  };

  return {
    sourcePlan,
    editablePlan,
    interactionStatus,
    notes,
    isSubmitting,
    isCompleted,
    isDirty,
    canApprove,
    canSubmitModify,
    errorText,
    validationErrorText,
    deletedPage,
    insertPageAt,
    deletePage,
    undoLastDelete,
    movePage,
    normalizeForSubmission,
    handleApprove,
    handleSubmitModify,
  };
}
