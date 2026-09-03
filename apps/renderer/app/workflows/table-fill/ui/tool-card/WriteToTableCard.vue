<template>
  <div class="write-to-table-card">
    <div v-if="isExecuting" class="loading-state">
      <div class="loading-spinner" />
      <span>{{ resolveCurrentTableFillMessage('tableFill.tool.loadingWrite') }}</span>
    </div>

    <div v-else-if="status === 'success'" class="content-container">
      <div class="meta-row">
        <span class="meta-item">
          {{ resolveCurrentTableFillMessage('tableFill.tool.modeLabel', { mode: modeLabel }) }}
        </span>
      </div>

      <div class="preview" :title="data.content">
        {{ data.previewText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { resolveCurrentTableFillMessage } from '../../functions/resolveCurrentTableFillMessage';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { WriteToTableCardPresentation } from '../../definitions/writeToTableCardPresentation';
import './WriteToTableCard.css';

const props = defineProps<{
  presentation: ToolCardPresentation<WriteToTableCardPresentation>;
  messageId?: string;
}>();

const status = computed(() => props.presentation.status);
const data = computed(() => props.presentation.data);
const isExecuting = computed(() => status.value === 'loading');
const modeLabel = computed(() => data.value.mode === 'replace'
  ? resolveCurrentTableFillMessage('tableFill.tool.mode.replace')
  : resolveCurrentTableFillMessage('tableFill.tool.mode.fill'));
</script>
