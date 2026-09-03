<!-- src/renderer/components/Outline/OutlineItem.vue -->
<template>
  <li
    class="outline-item editor-outline-item"
    :class="[`indent-${item.level}`]"
    v-bind="$attrs"
    :data-id="item.id"
  >
    <div 
      class="outline-item-content" 
      @click.stop="handleItemClick" 
      :class="{ 'is-active': isActive }"
    >
      <!-- 修改：根据 props 显示 SVG 按钮或点 -->
      <button 
        v-if="hasActualChildren && item.level < 6"
        class="collapse-toggle outline-indicator" 
        @click.stop="toggleCollapse"
        :class="{ 'is-collapsed': isCollapsed }"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <span v-else class="bullet-indicator outline-indicator">·</span>
      
      <span class="outline-item-text">{{ item.text }}</span>
    </div>
  </li>
</template>

<script setup>

const props = defineProps({
  item: {
    type: Object,
    required: true, // { id, text, level, pos, parentId, hasActualChildren }
  },
  navigateToHeading: {
    type: Function,
    required: true,
  },
  // --- 新增 Props --- 
  handleToggleCollapse: {
    type: Function,
    required: true,
  },
  isCollapsed: {
    type: Boolean,
    required: true,
  },
  hasActualChildren: {
    type: Boolean,
    required: true,
  },
  // 新增 prop：当前项是否为活动项（光标所在位置）
  isActive: {
    type: Boolean,
    default: false
  }
});

// 移除本地折叠状态和 hasChildren 计算属性

// --- 方法调整 --- 
const handleItemClick = () => {
  props.navigateToHeading(props.item);
};

const toggleCollapse = () => {
  // 调用父组件传递的函数来处理折叠状态
  props.handleToggleCollapse(props.item.id);
};

</script>
