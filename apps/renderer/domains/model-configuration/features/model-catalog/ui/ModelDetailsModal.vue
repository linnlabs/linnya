<template>
  <!-- 模型详情弹窗 -->
  <Modal
    :isVisible="show"
    :title="settingsMessage('settings.modelDetails.title')"
    @close="handleClose"
    width="420px"
    scroll-mode="content"
    :closeOnOverlayClick="!modalState.isProcessing"
    :closeOnEsc="!modalState.isProcessing"
  >
    <div class="model-details-content" v-if="model">
      <!-- 自定义名称编辑 -->
      <div class="form-row input-row">
        <label class="form-label">{{
          settingsMessage('settings.modelDetails.displayName.label')
        }}</label>
        <div class="control-area">
          <input
            type="text"
            v-model="editForm.display_name"
            class="settings-input"
            :placeholder="settingsMessage('settings.modelDetails.displayName.placeholder')"
            :disabled="modalState.isProcessing"
          />
        </div>
      </div>

      <!-- 模型名称 (底层) -->
      <div class="form-row input-row">
        <label class="form-label">{{
          settingsMessage('settings.modelDetails.modelName.label')
        }}</label>
        <div class="control-area">
          <input
            type="text"
            v-model="editForm.model_name"
            class="settings-input"
            :placeholder="settingsMessage('settings.modelDetails.modelName.placeholder')"
            :disabled="modalState.isProcessing"
          />
        </div>
      </div>

      <!-- API Key -->
      <div class="form-row input-row">
        <label class="form-label">{{
          settingsMessage('settings.modelDetails.apiKey.label')
        }}</label>
        <div class="control-area">
          <div class="info-text">
            {{ model.inference_route?.auth_profile === 'none' ? 'N/A' : '********' }}
          </div>
        </div>
      </div>

      <!-- API 地址 -->
      <div class="form-row input-row">
        <label class="form-label">{{
          settingsMessage('settings.modelDetails.apiAddress.label')
        }}</label>
        <div class="control-area">
          <div class="info-text">
            {{ model.inference_route?.base_url || 'N/A' }}
          </div>
        </div>
      </div>

      <!-- API 协议 -->
      <div class="form-row input-row">
        <label class="form-label">{{
          settingsMessage('settings.modelDetails.protocol.label')
        }}</label>
        <div class="control-area">
          <div class="info-text">{{ currentProviderProfileLabel }}</div>
        </div>
      </div>

      <div class="form-row input-row">
        <label class="form-label" for="model-context-window-tokens">{{
          settingsMessage('settings.modelCapacity.contextWindow.label')
        }}</label>
        <div class="control-area">
          <CustomNumberInput
            id="model-context-window-tokens"
            :model-value="editForm.context_window_tokens"
            :input-width="160"
            :min="1"
            :max="Number.MAX_SAFE_INTEGER"
            :step="1"
            align="left"
            show-spin-buttons
            :is-step-up-disabled="modalState.isProcessing"
            :is-step-down-disabled="modalState.isProcessing"
            :placeholder="settingsMessage('settings.modelCapacity.contextWindow.placeholder')"
            :disabled="modalState.isProcessing"
            @update:model-value="editForm.context_window_tokens = String($event)"
            @step-up="adjustTokenLimit('context_window_tokens', 1)"
            @step-down="adjustTokenLimit('context_window_tokens', -1)"
          />
        </div>
      </div>

      <div class="form-row input-row">
        <label class="form-label" for="model-max-output-tokens">{{
          settingsMessage('settings.modelCapacity.maxOutput.label')
        }}</label>
        <div class="control-area">
          <CustomNumberInput
            id="model-max-output-tokens"
            :model-value="editForm.max_output_tokens"
            :input-width="160"
            :min="1"
            :max="Number.MAX_SAFE_INTEGER"
            :step="1"
            align="left"
            show-spin-buttons
            :is-step-up-disabled="modalState.isProcessing"
            :is-step-down-disabled="modalState.isProcessing"
            :placeholder="settingsMessage('settings.modelCapacity.maxOutput.placeholder')"
            :disabled="modalState.isProcessing"
            @update:model-value="editForm.max_output_tokens = String($event)"
            @step-up="adjustTokenLimit('max_output_tokens', 1)"
            @step-down="adjustTokenLimit('max_output_tokens', -1)"
          />
        </div>
      </div>

      <!-- 模型能力 -->
      <div class="form-row input-row">
        <label class="form-label">{{
          settingsMessage('settings.modelCapability.imageInput')
        }}</label>
        <div class="control-area">
          <label class="toggle-switch">
            <input
              v-model="editForm.supports_image_input"
              type="checkbox"
              :disabled="modalState.isProcessing"
            />
            <span class="slider round" />
          </label>
        </div>
      </div>

      <!-- 模态框内错误信息 -->
      <div v-if="modalState.error" class="error-message">{{ modalState.error }}</div>

    </div>

    <template #footer>
      <div v-if="model" class="model-details-footer">
        <ActionButtons
          :secondary-action-text="settingsMessage('settings.modelDetails.delete')"
          :primary-action-text="primaryActionText"
          :is-primary-action-disabled="modalState.isProcessing || !hasChanges"
          @secondary-click="handleDeleteModel"
          @primary-click="handleSaveModel"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { reactive, watch, computed } from 'vue';
import type { ModelCatalogItem } from '../definitions/modelCatalog';
import type { EditableLanguageModelIssue } from '../definitions/editableLanguageModel';
import { ActionButtons, CustomNumberInput, Modal } from '@linnya/renderer-ui';
import { confirm } from '@shared/composables/confirmDialog';
import { useSettingsLocalization } from '@/domains/settings/public';
import { buildEditableLanguageModelUpdate } from '../functions/buildEditableLanguageModelUpdate';
import { updateModelInCatalog } from '../orchestration/modelCatalogOperations';
import { deleteConfiguredModel } from '../../../orchestration/deleteConfiguredModel';
import {
  resolveConfigurableLanguageProtocolLabelKey,
  resolveConfigurableLanguageRouteProfileId,
} from '../../inference-endpoints';
import './ModelDetailsModal.css';

interface Props {
  readonly show?: boolean;
  readonly model?: ModelCatalogItem | null;
}

interface EditForm {
  display_name: string;
  model_name: string;
  context_window_tokens: string;
  max_output_tokens: string;
  supports_image_input: boolean;
}

interface ModalState {
  isProcessing: boolean;
  error: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  show: false,
  model: null,
});

const emit = defineEmits<{
  close: [];
  'update-success': [operation: 'update' | 'delete'];
}>();

const { settingsMessage } = useSettingsLocalization();

// 编辑表单：统一管理所有可编辑字段
const editForm = reactive<EditForm>({
  display_name: '',
  model_name: '',
  context_window_tokens: '',
  max_output_tokens: '',
  supports_image_input: false,
});

const modalState = reactive<ModalState>({
  isProcessing: false,
  error: null,
});

function adjustTokenLimit(
  field: 'context_window_tokens' | 'max_output_tokens',
  delta: -1 | 1
): void {
  const current = Number(editForm[field]);
  if (!Number.isSafeInteger(current)) return;
  editForm[field] = String(Math.max(1, current + delta));
}

const primaryActionText = computed(() =>
  modalState.isProcessing
    ? settingsMessage('settings.modelDetails.saving')
    : settingsMessage('settings.modelDetails.save')
);

const currentProviderProfileLabel = computed(() => {
  if (!props.model?.inference_route) return settingsMessage('settings.protocol.auto');
  const profileId = resolveConfigurableLanguageRouteProfileId(props.model.inference_route);
  return settingsMessage(resolveConfigurableLanguageProtocolLabelKey(profileId));
});

// 检测表单是否有修改
const hasChanges = computed(() => {
  if (!props.model) return false;
  return (
    editForm.display_name !== (props.model.display_name || props.model.name || '') ||
    editForm.model_name !== (props.model.model_name || '') ||
    editForm.context_window_tokens !==
      String(props.model.inference_route?.context_window_tokens ?? '') ||
    editForm.max_output_tokens !== String(props.model.inference_route?.max_output_tokens ?? '') ||
    editForm.supports_image_input !== (props.model.capabilities?.includes('image_input') === true)
  );
});

// 监听模型变化，初始化编辑表单
watch(
  () => props.model,
  newModel => {
    if (newModel) {
      editForm.display_name = newModel.display_name || newModel.name || '';
      editForm.model_name = newModel.model_name || '';
      if (newModel.inference_route) {
        editForm.context_window_tokens = String(newModel.inference_route.context_window_tokens);
        editForm.max_output_tokens = String(newModel.inference_route.max_output_tokens);
      } else {
        editForm.context_window_tokens = '';
        editForm.max_output_tokens = '';
      }
      editForm.supports_image_input = newModel.capabilities?.includes('image_input') === true;
      modalState.error = null;
      modalState.isProcessing = false;
    }
  },
  { immediate: true }
);

const handleClose = () => {
  if (modalState.isProcessing) return;
  emit('close');
};

const handleDeleteModel = async () => {
  if (!props.model || modalState.isProcessing) return;

  modalState.isProcessing = true;
  modalState.error = null;
  const modelIdToDelete = props.model.id;
  const modelNameToDelete = props.model.display_name || props.model.name || props.model.id;

  const confirmed = await confirm({
    message: settingsMessage('settings.modelDetails.confirmDelete', {
      modelName: modelNameToDelete,
    }),
    isDangerousAction: true,
  });
  if (!confirmed) {
    modalState.isProcessing = false;
    return;
  }

  try {
    await deleteConfiguredModel(modelIdToDelete);
    emit('update-success', 'delete');
  } catch (error) {
    console.error(`删除模型 ${modelIdToDelete} 失败:`, error);
    modalState.error = settingsMessage('settings.modelDetails.deleteFailed');
  } finally {
    modalState.isProcessing = false;
  }
};

// 保存所有可编辑字段（不做增量对比，直接全量提交，避免比较遗漏）
const handleSaveModel = async () => {
  if (!props.model || modalState.isProcessing || !hasChanges.value) return;

  modalState.error = null;
  const result = buildEditableLanguageModelUpdate(props.model, {
    displayName: editForm.display_name,
    modelName: editForm.model_name,
    contextWindowTokens: editForm.context_window_tokens,
    maxOutputTokens: editForm.max_output_tokens,
    supportsImageInput: editForm.supports_image_input,
  });
  if (!result.ok) {
    modalState.error = resolveEditIssue(result.issue);
    return;
  }

  modalState.isProcessing = true;

  try {
    await updateModelInCatalog(props.model.id, result.command);
    emit('update-success', 'update');
  } catch (error) {
    console.error(`[ModelDetailsModal] 更新模型 ${props.model.id} 失败:`, error);
    modalState.error = settingsMessage('settings.modelDetails.updateFailed');
  } finally {
    modalState.isProcessing = false;
  }
};

function resolveEditIssue(issue: EditableLanguageModelIssue): string {
  switch (issue) {
    case 'display_name_required':
      return settingsMessage('settings.modelDetails.displayNameRequired');
    case 'model_name_required':
      return settingsMessage('settings.modelDetails.modelNameRequired');
    case 'inference_route_missing':
      return settingsMessage('settings.modelDetails.inferenceRouteMissing');
    case 'token_limits_invalid':
      return settingsMessage('settings.modelCapacity.validation.positiveIntegers');
  }
}
</script>
