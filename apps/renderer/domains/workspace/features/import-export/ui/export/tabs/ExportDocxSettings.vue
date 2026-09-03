<!-- src/renderer/components/Export/tabs/ExportDocxSettings.vue -->
<template>
  <div class="export-tab-content">
    <div class="placeholder-container">
      <p>{{ workspaceMessage('workspace.export.docx.placeholder') }}</p>
    </div>
  </div>
</template>

<script setup>
import { useWorkspaceLocalization } from '../../../../../ui/useWorkspaceLocalization';

const { workspaceMessage } = useWorkspaceLocalization();
</script>
