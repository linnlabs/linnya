<!-- packages/renderer-ui/src/features/feedback/ui/CharacterCount.vue -->
<template>
  <div class="character-count-display" ref="charCountRef">
    {{ label }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUpdated, watch, nextTick } from 'vue';
import { useSharedComponentLocalization } from '@linnya/renderer-ui/localization';

/**
 * 字数展示组件（仅展示，不负责计算口径）。
 *
 * 中文备注：
 * - “字数”口径由上游业务 owner 计算；package 不绑定 Host 的文本统计实现；
 * - 该组件的职责仅是展示与上报实际宽度，供布局计算使用（高内聚低耦合）。
 */
const props = defineProps<{
  count: number;
}>();

const emit = defineEmits<{
  (event: 'widthChange', width: number): void;
}>();

const charCountRef = ref<HTMLDivElement | null>(null);
const { sharedComponentMessage } = useSharedComponentLocalization();

const label = computed(() => sharedComponentMessage('shared.characterCount.label', {
  count: props.count,
}));

const updateWidth = () => {
  if (charCountRef.value) {
    nextTick(() => {
      if (charCountRef.value) {
        const width = charCountRef.value.offsetWidth;
        emit('widthChange', width);
      }
    });
  }
};

onMounted(() => {
  updateWidth();
});

// 监听 count 的变化
watch(() => props.count, () => {
  updateWidth(); 
}, { flush: 'post' });

onUpdated(() => {
   updateWidth();
});

</script>
