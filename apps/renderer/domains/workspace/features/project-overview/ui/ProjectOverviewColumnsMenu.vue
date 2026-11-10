<template>
  <BaseDropdown class="project-overview-columns">
    <template #trigger="{ toggle, isOpen }">
      <IconButton
        :label="workspaceMessage('workspace.projectOverview.columns.button')"
        size="md"
        :active="isOpen"
        aria-haspopup="dialog"
        :aria-expanded="isOpen"
        @click="toggle"
      >
        <OptionsIcon />
      </IconButton>
    </template>
    <template #content="{ isOpen }">
      <DropdownPanel
        :show="isOpen"
        class="project-overview-columns__panel"
        role="dialog"
        :aria-label="workspaceMessage('workspace.projectOverview.columns.button')"
      >
        <div class="project-overview-columns__label">
          {{ workspaceMessage('workspace.projectOverview.columns.heading') }}
        </div>
        <div role="group">
          <button
            v-for="column in shownColumns"
            :key="column.id"
            type="button"
            aria-pressed="true"
            class="project-overview-columns__item"
            :class="{
              'is-dragging': draggingId === column.id,
              'is-drop-target': dropTargetId === column.id && draggingId !== column.id,
            }"
            draggable="true"
            @click="emit('toggle', column.id)"
            @keydown.alt.up.prevent="moveBy(column.id, -1)"
            @keydown.alt.down.prevent="moveBy(column.id, 1)"
            @dragstart="handleDragStart($event, column.id)"
            @dragover.prevent="dropTargetId = column.id"
            @dragleave="handleDragLeave(column.id)"
            @drop.prevent="handleDrop(column.id)"
            @dragend="resetDrag"
          >
            <DragHandleIcon class="project-overview-columns__drag" />
            <span class="project-overview-columns__name">{{ columnLabel(column.id) }}</span>
            <CheckmarkIcon class="project-overview-columns__check" />
          </button>
        </div>
        <template v-if="hiddenColumns.length > 0">
          <div class="project-overview-columns__divider" />
          <div role="group">
            <button
              v-for="column in hiddenColumns"
              :key="column.id"
              type="button"
              aria-pressed="false"
              class="project-overview-columns__item is-hidden"
              @click="emit('toggle', column.id)"
            >
              <DragHandleIcon class="project-overview-columns__drag" />
              <span class="project-overview-columns__name">{{ columnLabel(column.id) }}</span>
            </button>
          </div>
        </template>
        <div class="project-overview-columns__divider" />
        <button type="button" class="project-overview-columns__reset" @click="emit('reset')">
          {{ workspaceMessage('workspace.projectOverview.columns.reset') }}
        </button>
      </DropdownPanel>
    </template>
  </BaseDropdown>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { BaseDropdown, DropdownPanel, IconButton } from '@linnya/renderer-ui';
import { CheckmarkIcon, DragHandleIcon, OptionsIcon } from '@linnya/renderer-ui/icons';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import type { ProjectOverviewColumnId, ProjectOverviewLayout } from '../definitions/projectOverview';
import { projectOverviewColumnMessageKey } from '../functions/projectOverviewPresentation';

const props = defineProps<{
  layout: ProjectOverviewLayout;
}>();

const emit = defineEmits<{
  toggle: [id: ProjectOverviewColumnId];
  move: [id: ProjectOverviewColumnId, targetId: ProjectOverviewColumnId];
  reset: [];
}>();

const { workspaceMessage } = useWorkspaceLocalization();
const shownColumns = computed(() => props.layout.columns.filter(column => column.visible));
const hiddenColumns = computed(() => props.layout.columns.filter(column => !column.visible));
const draggingId = ref<ProjectOverviewColumnId | null>(null);
const dropTargetId = ref<ProjectOverviewColumnId | null>(null);

function columnLabel(id: ProjectOverviewColumnId): string {
  return workspaceMessage(projectOverviewColumnMessageKey(id));
}

function handleDragStart(event: DragEvent, id: ProjectOverviewColumnId): void {
  draggingId.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }
}

function handleDragLeave(id: ProjectOverviewColumnId): void {
  if (dropTargetId.value === id) dropTargetId.value = null;
}

function handleDrop(targetId: ProjectOverviewColumnId): void {
  const id = draggingId.value;
  resetDrag();
  if (id && id !== targetId) emit('move', id, targetId);
}

function resetDrag(): void {
  draggingId.value = null;
  dropTargetId.value = null;
}

/** 键盘：Alt+↑/↓ 和相邻的显示列换位置。 */
function moveBy(id: ProjectOverviewColumnId, offset: -1 | 1): void {
  const columns = shownColumns.value;
  const index = columns.findIndex(column => column.id === id);
  const target = columns[index + offset];
  if (index >= 0 && target) emit('move', id, target.id);
}
</script>
