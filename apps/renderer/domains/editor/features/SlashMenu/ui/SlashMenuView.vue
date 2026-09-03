<template>
  <div class="slash-menu-wrapper">
    <div v-if="items.length > 0">
      <CustomSelect
        :model-value="null"
        :options="selectOptions"
        :manual-mode="true"
        :enable-keyboard-nav="true"
        min-width="200px"
        ref="customSelectRef"
        :on-select="handleSelect"
      />
    </div>
    <div v-else class="slash-menu-empty">
      {{ editorMessage('editor.slash.empty') }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  // 这个 command 函数由 Tiptap Suggestion 提供，用于执行选中项的命令
  command: {
    type: Function,
    required: true,
  },
});

const customSelectRef = ref(null);
const { editorMessage } = useEditorLocalization();

/**
 * 将 SlashMenu items 转换为 CustomSelect 需要的格式
 */
const selectOptions = computed(() => {
  return props.items.map(item => {
    if (item.isSeparator) {
      return { isSeparator: true };
    }
    
    if (item.isGroupTitle) {
      return { isGroup: true, label: item.groupName };
    }
    
    return {
      value: item.id || item.title,
      text: item.title,
    };
  });
});

/**
 * 处理选项选择（鼠标点击时由 CustomSelect emit 触发）
 */
const handleSelect = (value) => {
  // 找到对应的原始 item
  const item = props.items.find(i => !i.isSeparator && !i.isGroupTitle && (i.id === value || i.title === value));
  if (item) {
    props.command(item);
  }
};

/**
 * 键盘导航
 * - 直接委托给 CustomSelect：上下键切换高亮，Enter 确认高亮项
 * - 菜单刚出现时，CustomSelect 内部会默认选中第一个可用项，因此可直接 Enter 确认
 */
const onKeyDown = (args) => {
  if (customSelectRef.value) {
    return customSelectRef.value.onKeyDown(args);
  }
  return false;
};

// 暴露 onKeyDown 方法给父组件 (Suggestion render) 调用
defineExpose({
  onKeyDown,
});
</script>
