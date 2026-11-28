<template>
  <div class="plugin-cli-card">
    <div v-if="commandLine" class="plugin-cli-card__command-line">
      <span class="plugin-cli-card__prompt" aria-hidden="true">$</span>
      <code class="plugin-cli-card__command">{{ commandLine }}</code>
    </div>
    <pre v-if="output" class="plugin-cli-card__output" data-linnya-scrollbar="small">{{ output }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolCardPresentation } from '../types';
import type { PluginCliPresentationData } from './definitions/pluginCliPresentation';
import './PluginCliCard.css';

const props = defineProps<{
  presentation: ToolCardPresentation<PluginCliPresentationData>;
}>();

const commandLine = computed(() => props.presentation.data.commandLine ?? '');
const output = computed(() => (props.presentation.data.kind === 'completed' ? props.presentation.data.output : ''));
</script>
