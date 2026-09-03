<!-- apps/renderer/domains/workspace/ui/sidebar/components/ContextMenu.vue -->
<template>
  <div
    v-if="visible"
    class="context-menu-container"
    :style="{ top: `${y}px`, left: `${x}px` }"
    ref="menuRef"
    @contextmenu.prevent
    >
    <!-- 防止在菜单上再次右键点击 -->
    <CustomSelect
      :model-value="null"
      :options="menuOptions"
      :manual-mode="true"
      :parent-is-open="visible"
      semantic-role="menu"
      @update:model-value="handleSelect"
      @close="closeMenu"
      variant="minimal"
      :bordered="false"
      font-size="13px"
      :class-names="{ options: 'workspace-context-menu-options' }"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { getNodeMenuOptions } from '../composables/useContextMenu.js';

const props = defineProps({
  visible: Boolean,
  x: Number,
  y: Number,
  item: Object,
  batchSelection: Boolean,
});

const emit = defineEmits(['close', 'select']);

const menuRef = ref(null);

const menuOptions = computed(() => {
  return getNodeMenuOptions(props.item, {
    surface: props.batchSelection ? 'batch-context' : 'context',
    batchSelection: props.batchSelection,
  });
});

const handleSelect = (value) => {
  if (value) {
    emit('select', { action: value, item: props.item });
  }
  closeMenu();
};

const closeMenu = () => {
  emit('close');
};

const handleClickOutside = (event) => {
  // 当菜单可见且点击发生在菜单外部时，关闭菜单
  if (props.visible && menuRef.value && !menuRef.value.contains(event.target)) {
    closeMenu();
  }
};

onMounted(() => {
  // 使用捕获阶段的事件监听器，可以更早地处理点击事件
  document.addEventListener('click', handleClickOutside, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside, true);
});
</script>
