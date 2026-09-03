<template>
  <FloatingToolbar :show="isOpen" :position="position">
    <template v-for="item in items" :key="item.id">
      <div v-if="item.items" class="toolbar-group">
        <component
          v-for="button in item.items"
          :key="button.id"
          :is="button.component"
          v-bind="button.props"
        />
      </div>
      <component v-else :is="item.component" v-bind="item.props" />
    </template>
  </FloatingToolbar>
</template>

<script setup>
import { computed } from 'vue';
import { floatingToolbarService } from '../service';
import FloatingToolbar from './FloatingToolbar.vue';

const isOpen = computed(() => floatingToolbarService.state.isOpen);
const position = computed(() => floatingToolbarService.state.position);
const items = computed(() => floatingToolbarService.state.items);
</script>
