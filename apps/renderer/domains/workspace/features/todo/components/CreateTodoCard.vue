<template>
  <div v-if="isOpen" class="create-todo-card">
    <!-- Header -->
    <div class="card-header">
      <h3 class="header-title">{{ workspaceMessage('workspace.todo.create.title') }}</h3>
      <button
        type="button"
        class="close-button"
        @click="handleClose"
        :title="workspaceMessage('workspace.todo.create.close')"
      >
        <CloseIcon class="close-icon" />
      </button>
    </div>

    <form @submit.prevent="handleAdd" class="form-content">
      <!-- Title -->
      <input
        v-model="title"
        type="text"
        :placeholder="workspaceMessage('workspace.todo.create.titlePlaceholder')"
        class="form-input"
        autofocus
      />

      <!-- Description - 暂时隐藏
      <textarea
        v-model="description"
        placeholder="描述（可选）"
        rows="2"
        class="form-textarea"
      />
      -->

      <!-- Custom Tags -->
      <div class="form-group">
        <div class="tag-input-wrapper">
          <input
            v-model="tagInput"
            type="text"
            :placeholder="workspaceMessage('workspace.todo.create.tagPlaceholder')"
            class="form-input tag-input"
            @keydown.enter.prevent="addTag"
          />
          <button type="button" class="add-tag-button" @click="addTag">
            <AddIcon class="add-icon" />
          </button>
        </div>
        <div v-if="customTags.length > 0" class="tags-list">
          <!--
            这里不要额外包一层 span：
            - 在 flex 布局下，wrapper 容器会继承父级 line-height，造成“看起来更高”的错觉
            - 知识库等其它地方是直接渲染 TagChip 作为 flex item，高度更稳定一致
          -->
          <TagChip
            v-for="tag in customTags"
            :key="tag"
            :label="tag"
            closable
            @close="removeTag(tag)"
          >
            <template #icon>
              <TagIcon class="tag-icon" />
            </template>
          </TagChip>
        </div>
      </div>

      <!-- Priority -->
      <div class="form-field-row">
        <label class="todo-form-label">{{ workspaceMessage('workspace.todo.create.priority') }}</label>
        <div class="button-group">
          <button
            v-for="p in priorityOptions"
            :key="p"
            type="button"
            :class="['priority-tag', `priority-${p}`, { 'is-active': priority === p }]"
            @click="priority = p"
          >
            <span class="badge-dot"></span>
            {{ priorityLabels[p] }}
          </button>
        </div>
      </div>


      <!-- Due Date -->
      <div class="form-field-row">
        <label class="todo-form-label">{{ workspaceMessage('workspace.todo.create.date') }}</label>
        <div class="control-wrapper">
          <SimpleDatePicker
            v-model="dueDate"
            :placeholder="workspaceMessage('workspace.todo.create.datePlaceholder')"
          />
        </div>
      </div>

      <!-- Time Picker -->
      <div class="form-field-row">
        <label class="todo-form-label">{{ workspaceMessage('workspace.todo.create.time') }}</label>
        <div class="control-wrapper time-control-wrapper">
          <TimePicker
            v-model="dueDate"
            :placeholder="workspaceMessage('workspace.todo.create.timePlaceholder')"
          />
        </div>
      </div>


      <!-- Actions -->
      <div class="actions">
        <ActionButtons
          :secondary-action-text="workspaceMessage('workspace.todo.create.cancel')"
          :primary-action-text="workspaceMessage('workspace.todo.create.add')"
          :is-primary-action-disabled="!title.trim()"
          @secondary-click="handleClose"
        />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Todo } from '../types.ts';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { ActionButtons, SimpleDatePicker, TagChip, TimePicker } from '@linnya/renderer-ui';
import { TagIcon } from '@linnya/renderer-ui/icons';
import { useWorkspaceLocalization } from '../../../ui/useWorkspaceLocalization';

interface Props {
  isOpen: boolean;
}

defineProps<Props>();
const emit = defineEmits(['close', 'add']);
const { workspaceMessage } = useWorkspaceLocalization();

const title = ref('');
// const description = ref(''); 暂时隐藏描述功能
const priority = ref<'high' | 'medium' | 'low'>('medium');
const customTags = ref<string[]>([]);
const tagInput = ref('');
// 使用 Date 作为内部状态，同时区分存储到后端的日期（YYYY-MM-DD）和时间（HH:mm）
const dueDate = ref<Date | null>(null);

/**
 * 优先级选项与文案映射
 * - 不能把数组/映射直接内联在模板里，否则模板类型推导可能把 `p` 视为 any，触发 TS 索引报错
 * - 提升到 script 后，模板能推导出 p 为联合类型，从根上消除错误
 */
const priorityOptions = ['low', 'medium', 'high'] as const;
type PriorityValue = (typeof priorityOptions)[number];
const priorityLabels = computed<Record<PriorityValue, string>>(() => ({
  low: workspaceMessage('workspace.todo.priority.low'),
  medium: workspaceMessage('workspace.todo.priority.medium'),
  high: workspaceMessage('workspace.todo.priority.high'),
}));

function resetForm() {
  title.value = '';
  // description.value = ''; 暂时隐藏描述功能
  priority.value = 'medium';
  customTags.value = [];
  tagInput.value = '';
  dueDate.value = null;
}

function handleAdd() {
  if (title.value.trim()) {
    // 将内部 Date 拆分成日期字符串和时间字符串，符合 Todo 类型约定
    let dueDateStr: string | undefined;
    let dueTimeStr: string | undefined;

    if (dueDate.value) {
      const d = dueDate.value;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hour = String(d.getHours()).padStart(2, '0');
      const minute = String(d.getMinutes()).padStart(2, '0');

      dueDateStr = `${year}-${month}-${day}`;
      dueTimeStr = `${hour}:${minute}`;
    }

    const newStatus = dueDateStr ? 'scheduled' : 'todo';

    const payload: Omit<Todo, 'id'> = {
      title: title.value.trim(),
      // description: description.value.trim() || undefined, 暂时隐藏描述功能
      status: newStatus,
      priority: priority.value,
      customTags: customTags.value.length > 0 ? customTags.value : undefined,
      dueDate: dueDateStr,
      dueTime: dueTimeStr,
    };

    // 这里直接发射事件，由上层通过 store 和 IPC 完成真正的创建
    console.debug('[CreateTodoCard] Emitting add payload:', payload);
    emit('add', payload);
    resetForm();
  }
}

function handleClose() {
  emit('close');
  resetForm();
}

function addTag() {
  const trimmedTag = tagInput.value.trim();
  if (trimmedTag && !customTags.value.includes(trimmedTag)) {
    customTags.value.push(trimmedTag);
    tagInput.value = '';
  }
}

function removeTag(tag: string) {
  customTags.value = customTags.value.filter(t => t !== tag);
}
</script>
