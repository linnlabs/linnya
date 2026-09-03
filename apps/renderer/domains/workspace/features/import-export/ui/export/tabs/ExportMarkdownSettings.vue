<!-- src/renderer/components/Export/tabs/ExportMarkdownSettings.vue -->
<template>
  <div class="export-tab-content">
    
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
          <CustomRadio
            v-model="settings.lineBreakStyle"
              value="standard" 
            name="linebreak"
          >
            {{ workspaceMessage('workspace.export.batch.lineBreakStandard') }}
          </CustomRadio>
          <CustomRadio
              v-model="settings.lineBreakStyle"
              value="newline" 
            name="linebreak"
            >
            {{ workspaceMessage('workspace.export.batch.lineBreakNewline') }}
          </CustomRadio>
        </div>
      </div>
    </div>
    
  </div>
</template>

<script setup>
import { reactive, watch, onMounted } from 'vue';
import { useUIStore } from '../../../../../../../shared/stores/ui';
import { exportAsMarkdown } from '../../../services/exportService';
import { CustomCheckbox, CustomRadio } from '@linnya/renderer-ui';
import { useWorkspaceLocalization } from '../../../../../ui/useWorkspaceLocalization';

// 定义事件
const emit = defineEmits(['update-settings']);

const uiStore = useUIStore();
const { workspaceMessage } = useWorkspaceLocalization();

// 使用 reactive 管理设置状态
const settings = reactive({
  escapeSpecialChars: true,
  lineBreakStyle: 'standard' // 'standard' | 'newline'
});

// 监听设置变化并发送事件
watch(settings, (newSettings) => {
  emit('update-settings', JSON.parse(JSON.stringify(newSettings)));
}, { deep: true });

// 组件挂载后发送初始设置
onMounted(() => {
  emit('update-settings', JSON.parse(JSON.stringify(settings)));
});

// 父组件可以通过 ref 访问此函数来触发导出
const performExport = () => {
  const editor = uiStore.getEditor();
  if (!editor) {
    console.error("无法执行 Markdown 导出，编辑器实例不存在。");
    return;
  }

  // 使用当前设置调用 exportAsMarkdown 函数
  void exportAsMarkdown(editor, settings);
};

// 使用 defineExpose 将函数和状态暴露给父组件
defineExpose({
  performExport,
  settings, // 也可以暴露设置状态
});
</script>
