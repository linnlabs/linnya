<!-- src/renderer/components/Export/tabs/ExportTxtSettings.vue -->
<template>
  <div class="export-tab-content">
    
    <div class="form-row align-top">
      <label class="form-label">{{ workspaceMessage('workspace.export.txt.format') }}</label>
      <div class="control-area">
        <div class="radio-options">
          <div class="radio-item">
            <input 
              type="radio" 
              id="export-txt-plain" 
              value="plain" 
              v-model="selectedExportType"
            >
            <label for="export-txt-plain">{{ workspaceMessage('workspace.export.txt.plain') }}</label>
          </div>

          <div class="radio-item-with-description">
            <div class="radio-item">
              <input 
                type="radio" 
                id="export-txt-markdown-txt" 
                value="markdown-txt" 
                v-model="selectedExportType" 
              >
              <label for="export-txt-markdown-txt">{{ workspaceMessage('workspace.export.txt.markdownTxt') }}</label>
            </div>
            <p class="setting-description">
              {{ workspaceMessage('workspace.export.txt.markdownTxtDescription') }}
            </p>
          </div>
        </div>
      </div>
    </div>
    
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useUIStore } from '../../../../../../../shared/stores/ui';
import { exportAsPlainText, exportAsMarkdownTxt } from '../../../services/exportService';
import { useWorkspaceLocalization } from '../../../../../ui/useWorkspaceLocalization';

const uiStore = useUIStore();
const { workspaceMessage } = useWorkspaceLocalization();
const selectedExportType = ref('plain'); // 默认选中纯文本

// 父组件可以通过 ref 访问此函数来触发导出
const performExport = () => {
  const editor = uiStore.getEditor();
  if (!editor) {
    console.error("无法执行导出，编辑器实例不存在。");
    return;
  }

  if (selectedExportType.value === 'plain') {
    void exportAsPlainText(editor);
  } else if (selectedExportType.value === 'markdown-txt') {
    void exportAsMarkdownTxt(editor);
  }
};

// 使用 defineExpose 将函数和状态暴露给父组件
defineExpose({
  performExport,
  selectedExportType, // 也可以暴露所选类型
});
</script>
