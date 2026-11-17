<template>
  <div class="main-flow">
    <component v-if="surface" :is="surface.contribution.pageComponent" :key="surface.pluginId" />
  </div>
</template>
<script setup lang="ts">
import { useApplicationSurface } from '@/app/plugins/composables';
const surface = useApplicationSurface('knowledge-base');
</script>
