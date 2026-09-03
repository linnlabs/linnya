<template>
  <div ref="cardRef" class="ppt-plan-card">
    <template v-if="editablePlan">
      <div class="ppt-plan-card__heading">
        <span class="ppt-plan-card__heading-text">
          {{ slidesToolCardMessage('slides.plan.heading') }}
        </span>
      </div>

      <div class="ppt-plan-card__content" :class="{ 'ppt-plan-card__content--disabled': isCompleted }">
        <div v-if="interactionStatus.status !== 'active'" class="ppt-plan-card__status">
          {{ interactionStatus.status === 'approved'
            ? slidesToolCardMessage('slides.plan.status.approved')
            : slidesToolCardMessage('slides.plan.status.modified') }}
        </div>

        <div v-if="errorText" class="ppt-plan-card__error">{{ errorText }}</div>
        <div v-if="validationErrorText" class="ppt-plan-card__error">{{ validationErrorText }}</div>

        <section class="deck-section">
          <div
            class="editable-text deck-title"
            :class="{ 'editable-text--disabled': isCompleted }"
            :contenteditable="!isCompleted"
            role="textbox"
            :aria-label="slidesToolCardMessage('slides.plan.aria.presentationTitle')"
            @input="updateDeckTitle"
            @keydown.enter.prevent
          >
            {{ editablePlan.title }}
          </div>
          <div class="deck-meta">
            <span
              class="editable-text deck-audience"
              :class="{ 'editable-text--disabled': isCompleted, 'editable-text--placeholder': !editablePlan.audience }"
              :contenteditable="!isCompleted"
              :data-placeholder="slidesToolCardMessage('slides.plan.placeholder.audience')"
              role="textbox"
              :aria-label="slidesToolCardMessage('slides.plan.aria.audience')"
              @input="updateDeckAudience"
              @keydown.enter.prevent
            >
              {{ editablePlan.audience }}
            </span>
            <span class="deck-meta__separator">·</span>
            <span>{{ slidesToolCardMessage('slides.plan.pageCount', { count: editablePlan.pageCount }) }}</span>
          </div>
        </section>

        <section
          class="visual-direction-section"
          :aria-label="slidesToolCardMessage('slides.plan.aria.visualDirection')"
        >
          <div class="visual-direction-grid">
            <div class="visual-direction-row">
              <label class="visual-direction-row__label" :for="`ppt-plan-concept-${props.messageId}`">
                {{ slidesToolCardMessage('slides.plan.label.designConcept') }}
              </label>
              <CustomTextarea
                :id="`ppt-plan-concept-${props.messageId}`"
                v-model="editablePlan.visualDirection.concept"
                class="visual-direction-row__value"
                control-class="ppt-plan-card__visual-direction-control"
                :bordered="false"
                auto-grow
                rows="1"
                :auto-grow-min-height="28"
                :auto-grow-max-height="120"
                :disabled="isCompleted"
                :aria-label="slidesToolCardMessage('slides.plan.label.designConcept')"
              />
            </div>
            <div class="visual-direction-row">
              <label class="visual-direction-row__label" :for="`ppt-plan-composition-${props.messageId}`">
                {{ slidesToolCardMessage('slides.plan.label.composition') }}
              </label>
              <CustomTextarea
                :id="`ppt-plan-composition-${props.messageId}`"
                v-model="editablePlan.visualDirection.composition"
                class="visual-direction-row__value"
                control-class="ppt-plan-card__visual-direction-control"
                :bordered="false"
                auto-grow
                rows="1"
                :auto-grow-min-height="28"
                :auto-grow-max-height="120"
                :disabled="isCompleted"
                :aria-label="slidesToolCardMessage('slides.plan.label.composition')"
              />
            </div>
            <div class="visual-direction-row">
              <label class="visual-direction-row__label" :for="`ppt-plan-signature-${props.messageId}`">
                {{ slidesToolCardMessage('slides.plan.label.visualSignature') }}
              </label>
              <CustomTextarea
                :id="`ppt-plan-signature-${props.messageId}`"
                v-model="editablePlan.visualDirection.signature"
                class="visual-direction-row__value"
                control-class="ppt-plan-card__visual-direction-control"
                :bordered="false"
                auto-grow
                rows="1"
                :auto-grow-min-height="28"
                :auto-grow-max-height="120"
                :disabled="isCompleted"
                :aria-label="slidesToolCardMessage('slides.plan.label.visualSignature')"
              />
            </div>
          </div>
        </section>

        <section
          class="page-timeline"
          :class="{
            'page-timeline--dragging': isDraggingPage,
            'page-timeline--suppress-handle-hover': suppressHandleHover,
          }"
          :aria-label="slidesToolCardMessage('slides.plan.aria.pageOutline')"
        >
          <template v-for="(page, pageIndex) in editablePlan.pages" :key="page.localId">
            <div
              v-if="!isCompleted"
              class="page-insert-slot"
              :class="{ 'page-insert-slot--active': dragOverInsertIndex === pageIndex }"
              @dragover.prevent="setDragOverInsertIndex(pageIndex)"
              @dragleave="clearDragOverInsertIndex(pageIndex)"
              @drop.prevent="handleDropAt(pageIndex)"
            >
              <button type="button" class="page-insert-button" :disabled="isDraggingPage" @click="handleInsertPageAt(pageIndex)">
                <AddIcon class="page-insert-button__icon" />
                <span>{{ slidesToolCardMessage('slides.plan.action.addPage') }}</span>
              </button>
              <div
                v-if="isDraggingPage"
                class="page-drop-indicator"
                :class="{ 'page-drop-indicator--active': dragOverInsertIndex === pageIndex }"
              />
            </div>

            <article
              class="page-section"
              :class="{
                'page-section--handle-overlay': true,
                'page-section--editable': !isCompleted,
                'page-section--with-connector': pageIndex < editablePlan.pages.length - 1,
                'page-section--dragging': draggedPageLocalId === page.localId,
                'page-section--menu-open': activePageMenuLocalId === page.localId,
              }"
            >
              <button
                v-if="!isCompleted"
                :ref="(element) => setPageDragHandleRef(page.localId, element)"
                type="button"
                class="page-drag-handle"
                draggable="true"
                data-drag-handle="true"
                :aria-label="slidesToolCardMessage('slides.plan.aria.pageActions', { number: page.slideNumber })"
                @mousedown="handlePageHandleMouseDown(page.localId, $event)"
                @mouseup="handlePageHandleMouseUp(page.localId, $event)"
                @dragstart="handleDragStart(page.localId, $event)"
                @dragend="handleDragEnd"
                @contextmenu.prevent.stop="openPageActionMenu(page.localId)"
                @keydown.enter.prevent="togglePageActionMenu(page.localId)"
                @keydown.space.prevent="togglePageActionMenu(page.localId)"
              >
                <DragHandleIcon />
              </button>
              <div class="page-section__marker">{{ page.slideNumber }}</div>
              <div class="page-section__body">
                <div
                  class="editable-text page-section__title"
                  :class="{ 'editable-text--disabled': isCompleted, 'editable-text--placeholder': page.title.length === 0 }"
                  :contenteditable="!isCompleted"
                  :data-placeholder="slidesToolCardMessage('slides.plan.placeholder.pageTitle')"
                  role="textbox"
                  :aria-label="slidesToolCardMessage('slides.plan.aria.pageTitle', { number: page.slideNumber })"
                  :data-page-title-local-id="page.localId"
                  @input="updatePageTitle(pageIndex, $event)"
                  @keydown.enter.prevent
                >
                  {{ page.title }}
                </div>
                <div
                  class="editable-text page-section__content"
                  :class="{ 'editable-text--disabled': isCompleted, 'editable-text--placeholder': page.content.length === 0 }"
                  :contenteditable="!isCompleted"
                  :data-placeholder="slidesToolCardMessage('slides.plan.placeholder.pageContent')"
                  role="textbox"
                  :aria-label="slidesToolCardMessage('slides.plan.aria.pageContent', { number: page.slideNumber })"
                  @input="updatePageContent(pageIndex, $event)"
                >
                  {{ page.content }}
                </div>
              </div>
            </article>
          </template>

          <div
            v-if="!isCompleted"
            class="page-insert-slot"
            :class="{ 'page-insert-slot--active': dragOverInsertIndex === editablePlan.pages.length }"
            @dragover.prevent="setDragOverInsertIndex(editablePlan.pages.length)"
            @dragleave="clearDragOverInsertIndex(editablePlan.pages.length)"
            @drop.prevent="handleDropAt(editablePlan.pages.length)"
          >
            <button type="button" class="page-insert-button" :disabled="isDraggingPage" @click="handleInsertPageAt(editablePlan.pages.length)">
              <AddIcon class="page-insert-button__icon" />
              <span>{{ slidesToolCardMessage('slides.plan.action.addPage') }}</span>
            </button>
            <div
              v-if="isDraggingPage"
              class="page-drop-indicator"
              :class="{ 'page-drop-indicator--active': dragOverInsertIndex === editablePlan.pages.length }"
            />
          </div>
        </section>

        <Teleport to="body">
          <Transition name="ppt-plan-card-menu-fade">
            <div
              v-if="activePageMenuLocalId"
              ref="pageMenuWrapperRef"
              class="ppt-plan-card__page-action-menu-wrapper"
              :style="pageMenuPosition"
              @click.stop
              @contextmenu.prevent.stop
            >
              <CustomSelect
                :model-value="null"
                :options="activePageMenuOptions"
                :manual-mode="true"
                :parent-is-open="!!activePageMenuLocalId"
                :external-trigger-ref="activePageMenuAnchor"
                variant="minimal"
                :bordered="false"
                min-width="160px"
                @update:model-value="handlePageMenuSelect"
                @close="closePageActionMenu"
              />
            </div>
          </Transition>
        </Teleport>

        <div v-if="deletedPage" class="page-undo-notice">
          <span>{{ slidesToolCardMessage('slides.plan.notice.pageDeleted', { number: deletedPage.page.slideNumber }) }}</span>
          <button type="button" @click="undoLastDelete">
            {{ slidesToolCardMessage('slides.plan.action.undo') }}
          </button>
        </div>

        <section v-if="!isCompleted || notes.trim().length > 0" class="notes-section">
          <CustomTextarea
            v-model="notes"
            class="notes-section__content"
            control-class="ppt-plan-card__notes-control"
            :placeholder="slidesToolCardMessage('slides.plan.placeholder.notes')"
            :bordered="false"
            auto-grow
            rows="2"
            :auto-grow-min-height="56"
            :auto-grow-max-height="160"
            :disabled="isCompleted"
            :aria-label="slidesToolCardMessage('slides.plan.aria.notes')"
          />
        </section>

        <ActionButtons
          v-if="!isCompleted"
          class="actions"
          :secondary-action-text="slidesToolCardMessage('slides.plan.action.submitChanges')"
          :primary-action-text="slidesToolCardMessage('slides.plan.action.approveAndContinue')"
          secondary-variant="ghost"
          :is-secondary-action-disabled="!canSubmitModify || isSubmitting"
          :is-primary-action-disabled="!canApprove || isSubmitting"
          @secondary-click="handleSubmitModify"
          @primary-click="handleApprove"
        />
      </div>
    </template>

    <div v-else-if="props.presentation.status === 'loading'" class="loading-state">
      <span class="loading-text">{{ slidesToolCardMessage('slides.plan.loading') }}</span>
    </div>

    <div v-else-if="errorText" class="ppt-plan-card__error">{{ errorText }}</div>

    <div v-else class="ppt-plan-card__empty">
      {{ slidesToolCardMessage('slides.plan.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, type Component, type ComponentPublicInstance, type CSSProperties } from 'vue';
import {
  ActionButtons,
  CustomSelect,
  CustomTextarea,
} from '@linnya/renderer-ui';
import {
  AddIcon,
  DeleteIcon,
  DragHandleIcon,
} from '@linnya/renderer-ui/icons';
import { useSlidesToolCardLocalization } from '../ui/useSlidesToolCardLocalization';
import { usePptPlanInteraction } from './usePptPlanInteraction';
import type { PptPlanCardProps } from './usePptPlanInteraction';

type PageMenuAction = 'insert-before' | 'insert-after' | 'move-up' | 'move-down' | 'delete';

interface PageMenuOption {
  value: PageMenuAction;
  text: string;
  disabled?: boolean;
  variant?: 'danger';
  iconComponent?: Component;
}

interface PageMenuSeparatorOption {
  isSeparator: true;
}

type PageMenuItem = PageMenuOption | PageMenuSeparatorOption;

const props = defineProps<PptPlanCardProps>();
const { slidesToolCardMessage } = useSlidesToolCardLocalization();

const cardRef = ref<HTMLElement | null>(null);
const draggedPageLocalId = ref<string | null>(null);
const dragOverInsertIndex = ref<number | null>(null);
const activePageMenuLocalId = ref<string | null>(null);
const pageMenuWrapperRef = ref<HTMLElement | null>(null);
const pageDragHandleRefs = ref<Record<string, HTMLElement>>({});
const pageMenuPosition = ref<CSSProperties>({
  position: 'fixed',
  top: '0px',
  left: '0px',
  zIndex: 2100,
});
const pageHandleMouseDown = ref<{ localId: string; x: number; y: number } | null>(null);

const toolProps = computed(() => props);
const {
  editablePlan,
  interactionStatus,
  notes,
  isSubmitting,
  isCompleted,
  canApprove,
  canSubmitModify,
  errorText,
  validationErrorText,
  deletedPage,
  insertPageAt,
  deletePage,
  undoLastDelete,
  movePage,
  handleApprove,
  handleSubmitModify,
} = usePptPlanInteraction(toolProps, slidesToolCardMessage);

const activePageMenuIndex = computed(() => {
  if (!editablePlan.value || !activePageMenuLocalId.value) return -1;
  return editablePlan.value.pages.findIndex((page) => page.localId === activePageMenuLocalId.value);
});
const activePageMenuAnchor = computed(() => {
  const localId = activePageMenuLocalId.value;
  return localId ? pageDragHandleRefs.value[localId] ?? null : null;
});
const activePageMenuOptions = computed(() => {
  const pageIndex = activePageMenuIndex.value;
  return pageIndex >= 0 ? buildPageMenuOptions(pageIndex) : [];
});
const isDraggingPage = computed(() => draggedPageLocalId.value !== null);
const suppressHandleHover = ref(false);

function readEditableText(event: Event): string {
  const target = event.target;
  return target instanceof HTMLElement ? target.innerText.trim() : '';
}

function updateDeckTitle(event: Event): void {
  if (!editablePlan.value || isCompleted.value) return;
  editablePlan.value.title = readEditableText(event);
}

function updateDeckAudience(event: Event): void {
  if (!editablePlan.value || isCompleted.value) return;
  const audience = readEditableText(event);
  editablePlan.value.audience = audience.length > 0 ? audience : undefined;
}

function updatePageTitle(pageIndex: number, event: Event): void {
  if (!editablePlan.value || isCompleted.value) return;
  const page = editablePlan.value.pages[pageIndex];
  if (!page) return;
  page.title = readEditableText(event);
}

function updatePageContent(pageIndex: number, event: Event): void {
  if (!editablePlan.value || isCompleted.value) return;
  const page = editablePlan.value.pages[pageIndex];
  if (!page) return;
  page.content = readEditableText(event);
}

function buildPageMenuOptions(pageIndex: number): PageMenuItem[] {
  const pages = editablePlan.value?.pages ?? [];
  return [
    { value: 'insert-before', text: slidesToolCardMessage('slides.plan.menu.insertBefore') },
    { value: 'insert-after', text: slidesToolCardMessage('slides.plan.menu.insertAfter') },
    { value: 'move-up', text: slidesToolCardMessage('slides.plan.menu.moveUp'), disabled: pageIndex === 0 },
    {
      value: 'move-down',
      text: slidesToolCardMessage('slides.plan.menu.moveDown'),
      disabled: pageIndex >= pages.length - 1,
    },
    { isSeparator: true },
    {
      value: 'delete',
      text: slidesToolCardMessage('slides.plan.menu.delete'),
      disabled: pages.length <= 1,
      variant: 'danger',
      iconComponent: DeleteIcon,
    },
  ];
}

function isPageMenuAction(value: unknown): value is PageMenuAction {
  return value === 'insert-before' || value === 'insert-after' || value === 'move-up' || value === 'move-down' || value === 'delete';
}

async function focusPageTitle(localId: string): Promise<void> {
  await nextTick();
  const titleNode = Array.from(cardRef.value?.querySelectorAll<HTMLElement>('[data-page-title-local-id]') ?? []).find(
    (node) => node.dataset['pageTitleLocalId'] === localId,
  );
  titleNode?.focus();
}

async function handleInsertPageAt(index: number): Promise<void> {
  const localId = insertPageAt(index);
  if (localId) {
    await focusPageTitle(localId);
  }
}

async function handlePageMenuSelect(value: unknown): Promise<void> {
  const pageIndex = activePageMenuIndex.value;
  const localId = activePageMenuLocalId.value;
  if (!localId || pageIndex < 0) {
    closePageActionMenu();
    return;
  }
  if (!isPageMenuAction(value)) return;
  if (value === 'insert-before') {
    await handleInsertPageAt(pageIndex);
    closePageActionMenu();
    return;
  }
  if (value === 'insert-after') {
    await handleInsertPageAt(pageIndex + 1);
    closePageActionMenu();
    return;
  }
  if (value === 'move-up') {
    movePage(localId, pageIndex - 1);
    closePageActionMenu();
    return;
  }
  if (value === 'move-down') {
    movePage(localId, pageIndex + 2);
    closePageActionMenu();
    return;
  }
  deletePage(localId);
  closePageActionMenu();
}

function setPageDragHandleRef(localId: string, element: Element | ComponentPublicInstance | null): void {
  if (element instanceof HTMLElement) {
    pageDragHandleRefs.value[localId] = element;
    return;
  }
  delete pageDragHandleRefs.value[localId];
}

function calculatePageMenuPosition(): void {
  const anchor = activePageMenuAnchor.value;
  if (!anchor) return;

  const anchorRect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let menuWidth = 160;
  let menuHeight = 220;

  if (pageMenuWrapperRef.value) {
    const menuRect = pageMenuWrapperRef.value.getBoundingClientRect();
    if (menuRect.width > 0) {
      menuWidth = menuRect.width;
    }
    if (menuRect.height > 0) {
      menuHeight = menuRect.height;
    }
  }

  const leftCandidate = anchorRect.left - menuWidth - 6;
  const rightCandidate = anchorRect.right + 6;
  let left = leftCandidate >= 8 ? leftCandidate : rightCandidate;
  if (left + menuWidth > viewportWidth - 8) {
    left = Math.max(8, viewportWidth - menuWidth - 8);
  }

  let top = anchorRect.top;
  if (top + menuHeight > viewportHeight - 8 && anchorRect.bottom > viewportHeight - anchorRect.top) {
    top = Math.max(8, anchorRect.bottom - menuHeight);
  }

  pageMenuPosition.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    zIndex: 2100,
  };
}

async function openPageActionMenu(localId: string): Promise<void> {
  activePageMenuLocalId.value = localId;
  await nextTick();
  calculatePageMenuPosition();
  await nextTick();
  calculatePageMenuPosition();
}

function closePageActionMenu(): void {
  activePageMenuLocalId.value = null;
}

function togglePageActionMenu(localId: string): void {
  if (isCompleted.value) return;
  if (activePageMenuLocalId.value === localId) {
    closePageActionMenu();
    return;
  }
  void openPageActionMenu(localId);
}

function handlePageHandleMouseDown(localId: string, event: MouseEvent): void {
  if (isCompleted.value || event.button !== 0) return;
  document.body.style.userSelect = 'none';
  pageHandleMouseDown.value = { localId, x: event.clientX, y: event.clientY };
}

function handlePageHandleMouseUp(localId: string, event: MouseEvent): void {
  document.body.style.userSelect = '';
  if (isCompleted.value || event.button !== 0) return;
  const mouseDown = pageHandleMouseDown.value;
  pageHandleMouseDown.value = null;
  if (!mouseDown || mouseDown.localId !== localId || isDraggingPage.value) return;

  const moveDistance = Math.sqrt((event.clientX - mouseDown.x) ** 2 + (event.clientY - mouseDown.y) ** 2);
  if (moveDistance > 5) return;

  event.preventDefault();
  event.stopPropagation();
  togglePageActionMenu(localId);
}

function handleDragStart(localId: string, event: DragEvent): void {
  if (isCompleted.value) return;
  closePageActionMenu();
  draggedPageLocalId.value = localId;
  suppressHandleHover.value = true;
  event.dataTransfer?.setData('text/plain', localId);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function handleDragEnd(): void {
  draggedPageLocalId.value = null;
  dragOverInsertIndex.value = null;
  pageHandleMouseDown.value = null;
  document.body.style.userSelect = '';
  suppressHandleHover.value = false;
}

function setDragOverInsertIndex(index: number): void {
  if (!draggedPageLocalId.value) return;
  dragOverInsertIndex.value = index;
}

function clearDragOverInsertIndex(index: number): void {
  if (dragOverInsertIndex.value === index) {
    dragOverInsertIndex.value = null;
  }
}

function handleDropAt(index: number): void {
  const localId = draggedPageLocalId.value;
  if (!localId) return;
  movePage(localId, index);
  handleDragEnd();
}

onBeforeUnmount(() => {
  document.body.style.userSelect = '';
  suppressHandleHover.value = false;
});
</script>
