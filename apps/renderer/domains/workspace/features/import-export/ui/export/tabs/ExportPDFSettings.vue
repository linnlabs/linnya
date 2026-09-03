<!-- src/renderer/components/Export/tabs/ExportPDFSettings.vue -->
<template>
  <div class="export-tab-content">
    <!-- 纸张大小 -->
    <div class="form-row">
      <label for="pdf-page-size" class="form-label">
        {{ workspaceMessage('workspace.export.pdf.pageSize') }}
      </label>
      <div class="control-area">
        <div class="custom-select-wrapper">
          <CustomSelect
            id="pdf-page-size"
            v-model="settings.pageSize"
            :options="pageSizeOptions"
            :title="workspaceMessage('workspace.export.pdf.pageSizeTitle')"
            :bordered="false"
            :class-names="{ trigger: 'export-pdf-page-size-trigger' }"
          />
        </div>
      </div>
    </div>

    <!-- 页面方向 -->
    <div class="form-row">
      <label class="form-label">{{ workspaceMessage('workspace.export.pdf.orientation') }}</label>
      <div class="control-area">
        <div class="radio-options">
          <div class="radio-item">
            <input 
              type="radio" 
              id="orientation-portrait" 
              value="portrait" 
              v-model="settings.orientation"
            >
            <label for="orientation-portrait">{{ workspaceMessage('workspace.export.pdf.orientationPortrait') }}</label>
          </div>
          <div class="radio-item">
            <input 
              type="radio" 
              id="orientation-landscape" 
              value="landscape" 
              v-model="settings.orientation"
            >
            <label for="orientation-landscape">{{ workspaceMessage('workspace.export.pdf.orientationLandscape') }}</label>
          </div>
        </div>
      </div>
    </div>

    <!-- 边距设置 -->
    <div class="form-row align-top">
      <label class="form-label">{{ workspaceMessage('workspace.export.pdf.margins') }}</label>
      <div class="control-area">
        <div class="margin-inputs">
          <CustomNumberInput
            :label="workspaceMessage('workspace.export.pdf.marginTop')"
            input-class="export-pdf-margin-input"
            v-model.number="settings.margins.top"
            min="0"
            max="10"
            step="0.1"
            id="pdf-margin-top"
          />
          <CustomNumberInput
            :label="workspaceMessage('workspace.export.pdf.marginBottom')"
            input-class="export-pdf-margin-input"
            v-model.number="settings.margins.bottom"
            min="0"
            max="10"
            step="0.1"
            id="pdf-margin-bottom"
          />
          <CustomNumberInput
            :label="workspaceMessage('workspace.export.pdf.marginLeft')"
            input-class="export-pdf-margin-input"
            v-model.number="settings.margins.left"
            min="0"
            max="10"
            step="0.1"
            id="pdf-margin-left"
          />
          <CustomNumberInput
            :label="workspaceMessage('workspace.export.pdf.marginRight')"
            input-class="export-pdf-margin-input"
            v-model.number="settings.margins.right"
            min="0"
            max="10"
            step="0.1"
            id="pdf-margin-right"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { reactive, watch, onMounted } from 'vue';
import { CustomNumberInput } from '@linnya/renderer-ui';
import { CustomSelect } from '@linnya/renderer-ui';
import { useWorkspaceLocalization } from '../../../../../ui/useWorkspaceLocalization';

// 定义事件
const emit = defineEmits(['update-settings']);
const { workspaceMessage } = useWorkspaceLocalization();

// 纸张大小选项
const pageSizeOptions = [
  { value: 'A4', text: 'A4 (210 × 297 mm)' },
  { value: 'A3', text: 'A3 (297 × 420 mm)' },
  { value: 'Letter', text: 'Letter (8.5 × 11 in)' },
  { value: 'Legal', text: 'Legal (8.5 × 14 in)' },
];

// 使用 reactive 管理设置状态
const settings = reactive({
  pageSize: 'A4',
  orientation: 'portrait',
  margins: {
    top: 2.54,
    right: 2.54,
    bottom: 2.54,
    left: 2.54,
  }
});

// 监听设置变化并发送事件
watch(settings, (newSettings) => {
  emit('update-settings', JSON.parse(JSON.stringify(newSettings)));
}, { deep: true });

// 组件挂载后发送初始设置
onMounted(() => {
  emit('update-settings', JSON.parse(JSON.stringify(settings)));
});
</script>
