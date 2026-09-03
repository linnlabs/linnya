<template>
  <button @click="$emit('toggle')" class="section-header">
    <ChevronIcon v-if="collapsible" :class="['chevron', { 'is-expanded': isExpanded }]" />
    <span :class="['title', isExpanded ? color : 'text-secondary']">{{ title }}</span>
    <span class="count">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
import { ChevronIcon } from '@linnya/renderer-ui/icons';

interface Props {
  title: string;
  count: number;
  isExpanded: boolean;
  color?: string;
  collapsible?: boolean;
}

withDefaults(defineProps<Props>(), {
  color: 'text-foreground',
  collapsible: true,
});

defineEmits(['toggle']);
</script>
