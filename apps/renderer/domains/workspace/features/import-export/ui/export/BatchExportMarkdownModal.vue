<template>
  <Modal
    :isVisible="isVisible"
    :title="workspaceMessage('workspace.export.batch.title')"
    width="520px"
    scroll-mode="content"
    @close="emit('close')"
  >
    <div class="workspace-batch-export-markdown-modal">
      <div class="form-row align-top">
        <label class="form-label">{{ workspaceMessage('workspace.export.batch.options') }}</label>
        <div class="control-area">
          <div class="checkbox-options">
            <CustomCheckbox v-model="settings.escapeSpecialChars">
              <span>{{ workspaceMessage('workspace.export.batch.escapeSpecialChars') }}</span>
              <template #description>
                {{ workspaceMessage('workspace.export.batch.escapeSpecialCharsDescription') }}
              </template>
            </CustomCheckbox>
          </div>
        </div>
      </div>

      <div class="form-row">
        <label class="form-label">{{ workspaceMessage('workspace.export.batch.lineBreakStyle') }}</label>
        <div class="control-area">
          <div class="radio-options">
            <CustomRadio v-model="settings.lineBreakStyle" value="standard" name="linebreak">
              {{ workspaceMessage('workspace.export.batch.lineBreakStandard') }}
            </CustomRadio>
            <CustomRadio v-model="settings.lineBreakStyle" value="newline" name="linebreak">
              {{ workspaceMessage('workspace.export.batch.lineBreakNewline') }}
            </CustomRadio>
          </div>
        </div>
      </div>

      <!-- 中文说明：描述信息放在操作按钮上方（用户更容易在点击前确认规则） -->
      <div class="tip-text tip-text-top">
        {{ workspaceMessage('workspace.export.batch.scopeTip') }}
      </div>
      <div class="tip-text tip-text-top-secondary">
        {{ workspaceMessage('workspace.export.batch.currentProject', { projectName: projectName || workspaceMessage('workspace.sidebar.fileTree.currentProject') }) }}
      </div>
    </div>

    <template #footer>
      <div class="workspace-batch-export-markdown-footer">
        <ActionButtons
          :secondary-action-text="workspaceMessage('workspace.export.batch.cancel')"
          :primary-action-text="workspaceMessage('workspace.export.batch.export')"
          :is-primary-action-disabled="isExportDisabled"
          @secondary-click="emit('close')"
          @primary-click="handleConfirm"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { MarkdownExportSettings } from '../../../../../../shared/utils/markdownSerializer';
import { ActionButtons, CustomCheckbox, CustomRadio, Modal } from '@linnya/renderer-ui';
import { useWorkspaceLocalization } from '../../../../ui/useWorkspaceLocalization';

const props = defineProps<{
  isVisible: boolean;
  projectName: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirm', settings: MarkdownExportSettings): void;
}>();
const { workspaceMessage } = useWorkspaceLocalization();

type LocalMarkdownSettings = {
  escapeSpecialChars: boolean;
  lineBreakStyle: 'standard' | 'newline';
};

// 中文说明：设置项与 ExportMarkdownSettings.vue 保持一致
const settings = reactive<LocalMarkdownSettings>({
  escapeSpecialChars: true,
  lineBreakStyle: 'standard',
});

const isExportDisabled = computed(() => false);

const handleConfirm = () => {
  emit('confirm', {
    escapeSpecialChars: settings.escapeSpecialChars,
    lineBreakStyle: settings.lineBreakStyle,
  });
};
</script>
