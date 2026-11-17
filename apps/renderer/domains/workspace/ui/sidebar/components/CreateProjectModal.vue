<!-- apps/renderer/domains/workspace/ui/sidebar/components/CreateProjectModal.vue -->
<template>
  <Modal 
    :isVisible="show" 
    :title="isEditMode ? workspaceMessage('workspace.project.modal.editTitle') : workspaceMessage('workspace.project.modal.createTitle')"
    @close="handleClose"
    width="520px"
    scroll-mode="content"
    :closeOnOverlayClick="!isProcessing"
    :closeOnEsc="!isProcessing"
  >
    <div class="create-project-content">
      <!-- 项目名称 -->
      <div class="form-row input-row">
        <label class="form-label">{{ workspaceMessage('workspace.project.modal.nameLabel') }} <span class="required">*</span></label>
        <div class="control-area">
          <input 
            ref="projectNameInput"
            type="text" 
            v-model="formData.name" 
            class="settings-input" 
            :placeholder="workspaceMessage('workspace.project.modal.namePlaceholder')"
            :disabled="isProcessing"
            @keyup.enter="handleConfirm"
          >
        </div>
      </div>
      
      <!-- 项目描述 -->
      <div class="form-row input-row">
        <label class="form-label">{{ workspaceMessage('workspace.project.modal.descriptionLabel') }}</label>
        <div class="control-area">
          <textarea
            ref="descriptionTextarea"
            v-model="formData.description" 
            class="settings-textarea" 
            :placeholder="workspaceMessage('workspace.project.modal.descriptionPlaceholder')"
            :disabled="isProcessing"
            rows="5"
            @input="autoResizeTextarea"
          ></textarea>
        </div>
      </div>

      <component
        v-if="show && !isEditMode && knowledgeSurface?.contribution.projectCreationComponent"
        :is="knowledgeSurface.contribution.projectCreationComponent"
        :key="knowledgeSurface.pluginId"
        v-model="linkedKnowledgeBaseIds"
        :disabled="isProcessing"
      />

      <!-- 错误信息 -->
      <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    </div>

    <template #footer>
      <div class="create-project-footer">
        <!-- 非编辑模式下显示：使用 ActionButtons 渲染的 AI 辅助创建按钮 -->
        <ActionButtons
          v-if="!isEditMode"
          class="ai-action-group"
          :primary-action-text="workspaceMessage('workspace.project.modal.aiCreate')"
          :is-primary-action-disabled="isProcessing || !formData.name.trim()"
          :show-secondary-action="false"
          primary-variant="accent"
          @primary-click="handleAiCreate"
        >
          <template #primary-content>
            <LinnyaIcon class="ai-icon" />
            <span>{{ workspaceMessage('workspace.project.modal.aiCreate') }}</span>
          </template>
        </ActionButtons>
        <ActionButtons
          :secondary-action-text="workspaceMessage('workspace.project.modal.cancel')"
          :primary-action-text="primaryActionText"
          :is-primary-action-disabled="isProcessing || !formData.name.trim()"
          @secondary-click="handleClose"
          @primary-click="handleConfirm"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ActionButtons, applyTextareaAutoResize, Modal } from '@linnya/renderer-ui';
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import { useApplicationSurface } from '@/app/plugins/composables';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import type { ProjectFormValues } from '../definitions/projectOperations';

// 组件接口定义
type InitialProjectData = {
  id: string;
  name: string;
  description?: string;
};

const props = defineProps<{
  show: boolean;
  isEditMode: boolean;
  initialData: InitialProjectData | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirm', payload: ProjectFormValues): void;
  (e: 'ai-create', payload: ProjectFormValues): void;
}>();
const { workspaceMessage } = useWorkspaceLocalization();

// 组件状态
const formData = reactive({
  name: '',
  description: ''
});

const isProcessing = ref(false);
const errorMessage = ref('');
const projectNameInput = ref<HTMLInputElement | null>(null);
const descriptionTextarea = ref<HTMLTextAreaElement | null>(null);

const knowledgeSurface = useApplicationSurface('knowledge-base');
const linkedKnowledgeBaseIds = ref<string[]>([]);
watch(knowledgeSurface, () => { linkedKnowledgeBaseIds.value = []; });

const primaryActionText = computed(() => {
  if (isProcessing.value) {
    return props.isEditMode
      ? workspaceMessage('workspace.project.modal.saving')
      : workspaceMessage('workspace.project.modal.creating');
  }

  return props.isEditMode
    ? workspaceMessage('workspace.project.modal.save')
    : workspaceMessage('workspace.project.modal.create');
});

// 监听显示状态，自动聚焦输入框
watch(() => props.show, async (newShow) => {
  if (newShow) {
    // 根据模式设置表单数据
    if (props.isEditMode && props.initialData) {
      formData.name = props.initialData.name;
      formData.description = props.initialData.description || '';
    } else {
      formData.name = workspaceMessage('workspace.project.modal.defaultProjectName');
      formData.description = '';
    }
    
    errorMessage.value = '';
    isProcessing.value = false;
    linkedKnowledgeBaseIds.value = [];

    // 等待 DOM 更新后聚焦
    await nextTick();
    if (props.show && projectNameInput.value) {
      projectNameInput.value.focus();
      if (!props.isEditMode) {
        projectNameInput.value.select(); // 创建模式下自动选中默认文本
      }
    }
  }
}, { immediate: true });

// 关闭模态框
const handleClose = () => {
  if (isProcessing.value) return; // 防止在处理时关闭
  emit('close');
};

// 自动调整 textarea 高度
const autoResizeTextarea = () => {
  if (!descriptionTextarea.value) return;
  applyTextareaAutoResize(descriptionTextarea.value, { maxHeight: 200 });
};

// 已有项目的编辑不处理关联；停用期间新建项目不提交先前尚未保存的关联草稿。
const getNormalizedKbIdsForSubmit = (): string[] => knowledgeSurface.value?.contribution.projectCreationComponent
  && !props.isEditMode ? [...linkedKnowledgeBaseIds.value] : [];

// 确认创建
const handleConfirm = () => {
  if (isProcessing.value || !formData.name.trim()) return;
  
  errorMessage.value = '';
  
  // 表单验证
  if (formData.name.trim().length < 1) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameRequired');
    return;
  }
  
  if (formData.name.trim().length > 100) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameTooLong');
    return;
  }
  
  // 发送确认事件，由父组件处理实际的创建逻辑
  emit('confirm', {
    name: formData.name.trim(),
    description: formData.description.trim(),
    kbIds: getNormalizedKbIdsForSubmit()
  });
};

// AI 辅助创建
const handleAiCreate = () => {
  if (isProcessing.value || !formData.name.trim()) return;
  
  errorMessage.value = '';
  
  // 表单验证
  if (formData.name.trim().length < 1) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameRequired');
    return;
  }
  
  if (formData.name.trim().length > 100) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameTooLong');
    return;
  }
  
  // 发送 AI 创建事件，由父组件处理
  emit('ai-create', {
    name: formData.name.trim(),
    description: formData.description.trim(),
    kbIds: getNormalizedKbIdsForSubmit()
  });
};
</script>
