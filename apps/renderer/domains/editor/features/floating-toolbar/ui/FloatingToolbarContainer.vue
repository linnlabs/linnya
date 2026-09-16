<template>
  <FloatingToolbar :show="isOpen" :position="position" data-editor-floating-toolbar @mousedown.prevent>
    <template v-for="item in items" :key="item.id">
      <ToolbarGroup v-if="item.items">
        <component
          v-for="button in item.items"
          :key="button.id"
          :is="button.component"
          v-bind="button.props"
        />
      </ToolbarGroup>
      <component v-else :is="item.component" v-bind="item.props" />
    </template>
  </FloatingToolbar>
</template>

<script setup>
import { computed } from 'vue';
import { floatingToolbarService } from '../service';
import { FloatingToolbar, ToolbarGroup } from '@linnya/renderer-ui';

const isOpen = computed(() => floatingToolbarService.state.isOpen);
const position = computed(() => floatingToolbarService.state.position);
const items = computed(() => floatingToolbarService.state.items);
</script>
