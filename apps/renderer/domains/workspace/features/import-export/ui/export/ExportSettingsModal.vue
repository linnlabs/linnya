<!-- src/renderer/components/Export/ExportSettingsModal.vue -->
<template>
  <Modal 
    :isVisible="uiStore.exportSettingsModalVisible" 
    :title="modalTitle"
    @close="closeExportSettings"
    width="500px"
    scroll-mode="internal"
  >
    <div class="export-settings-content">
      <!-- 根据 currentExportType 动态加载设置组件 -->
      <ExportTxtSettings 
        v-if="uiStore.currentExportType === 'txt'" 
        ref="txtSettingsComponentRef"
      />
      <ExportMarkdownSettings 
        v-else-if="uiStore.currentExportType === 'markdown'" 
        ref="markdownSettingsComponentRef"
      />
      <ExportPDFSettings 
        v-else-if="uiStore.currentExportType === 'pdf'" 
        @update-settings="handlePdfSettingsUpdate" 
      />
      <ExportDocxSettings v-else-if="uiStore.currentExportType === 'docx'" />
      <div v-else>{{ workspaceMessage('workspace.export.modal.invalidType') }}</div>
    </div>

    <template #footer>
      <div class="export-settings-footer">
        <ActionButtons
          :secondary-action-text="workspaceMessage('workspace.export.modal.cancel')"
          :primary-action-text="workspaceMessage('workspace.export.modal.export')"
          :is-primary-action-disabled="isExportDisabled"
          @secondary-click="closeExportSettings"
          @primary-click="handleConfirmExport"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useUIStore } from '../../../../../../shared/stores/ui';
import { useNotificationStore } from '@/app/notification';

// 导入具体的设置组件
import ExportTxtSettings from './tabs/ExportTxtSettings.vue';
import ExportMarkdownSettings from './tabs/ExportMarkdownSettings.vue';
import ExportPDFSettings from './tabs/ExportPDFSettings.vue';
import ExportDocxSettings from './tabs/ExportDocxSettings.vue';
import { ActionButtons, Modal } from '@linnya/renderer-ui';
import { useWorkspaceLocalization } from '../../../../ui/useWorkspaceLocalization';

// 导入导出服务
import { exportAsPDF, exportAsWord } from '../../services/exportService';

const uiStore = useUIStore();
const notificationStore = useNotificationStore();
const { workspaceMessage } = useWorkspaceLocalization();

// ++ 新增：为 TxtSettings 和 MarkdownSettings 组件创建 ref ++
const txtSettingsComponentRef = ref(null);
const markdownSettingsComponentRef = ref(null);

// ++ 新增：计算属性，用于判断导出按钮是否应被禁用 ++
const isExportDisabled = computed(() => {
  // 当导出类型为 docx 时，禁用按钮
  return uiStore.currentExportType === 'docx';
});

// ++ 新增：用于存储从 PDF 设置组件接收到的最新设置 ++
const currentPdfSettings = ref({});

// ++ 新增：处理来自 PDF 设置组件的事件 ++
const handlePdfSettingsUpdate = (newSettings) => {
  currentPdfSettings.value = newSettings;
};

// 计算模态框标题
const modalTitle = computed(() => {
  switch (uiStore.currentExportType) {
    case 'txt': return workspaceMessage('workspace.export.modal.title.txt');
    case 'markdown': return workspaceMessage('workspace.export.modal.title.markdown');
    case 'pdf': return workspaceMessage('workspace.export.modal.title.pdf');
    case 'docx': return workspaceMessage('workspace.export.modal.title.docx');
    default: return workspaceMessage('workspace.export.modal.title.settings');
  }
});

// 关闭模态框
const closeExportSettings = () => {
  uiStore.setExportSettingsVisible(false, null); // 关闭并重置类型
};

// 处理确认导出
const handleConfirmExport = () => {
  const type = uiStore.currentExportType;
  
  // ++ 修改：对于 txt 类型，直接调用子组件的方法 ++
  if (type === 'txt') {
    if (txtSettingsComponentRef.value && typeof txtSettingsComponentRef.value.performExport === 'function') {
      txtSettingsComponentRef.value.performExport();
      closeExportSettings(); // 导出后关闭模态框
      return;
    } else {
      console.error('[ExportModal] TxtSettings component or its performExport method is not available.');
      notificationStore.show(workspaceMessage('workspace.export.modal.txtSettingsUnavailable'), 'error', 3500);
      return;
    }
  }

  // ++ 新增：对于 markdown 类型，直接调用子组件的方法 ++
  if (type === 'markdown') {
    if (markdownSettingsComponentRef.value && typeof markdownSettingsComponentRef.value.performExport === 'function') {
      markdownSettingsComponentRef.value.performExport();
      closeExportSettings(); // 导出后关闭模态框
      return;
    } else {
      console.error('[ExportModal] MarkdownSettings component or its performExport method is not available.');
      notificationStore.show(workspaceMessage('workspace.export.modal.markdownSettingsUnavailable'), 'error', 3500);
      return;
    }
  }

  const editorInstance = uiStore.getEditor();
  if (!editorInstance) { 
    console.error('[ExportModal] Editor instance is not available from store. Cannot export.');
    notificationStore.show(workspaceMessage('workspace.export.modal.editorUnavailable'), 'error', 3500);
    return;
  }
  
  let settings = {};
  if (type === 'pdf') {
    settings = currentPdfSettings.value;
    if (!settings || Object.keys(settings).length === 0) {
        settings = { pageSize: 'A4', margins: { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 } }; 
    }
  } else if (type === 'txt') {
    // 未来可以从 TxtSettings 组件获取设置（同样建议用事件）
  }
  // else if (type === 'docx') { ... }
  
  // 根据类型调用相应的导出服务，并传递设置
  if (type === 'pdf') {
    void exportAsPDF(editorInstance, settings); // 传递 PDF 设置
  } else if (type === 'docx') {
    exportAsWord(editorInstance); // 暂未传递设置
  } else {
    console.error('[ExportModal] Invalid export type on confirm:', type);
    notificationStore.show(workspaceMessage('workspace.export.modal.invalidTypeAlert'), 'error', 3500);
    return;
  }
  
  closeExportSettings(); // 导出后关闭模态框
};
</script>
