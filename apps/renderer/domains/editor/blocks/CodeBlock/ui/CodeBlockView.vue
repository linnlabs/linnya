<!-- src/renderer/features/CodeBlock/ui/CodeBlockView.vue -->

<template>
  <node-view-wrapper
    ref="nodeViewWrapperRef"
    class="code-block-outer"
    :data-node-type="'codeBlockOuter'"
    :data-block-id="node.attrs.id"
  >
    <!-- 始终显示的语言名称 -->
    <div class="language-display" contenteditable="false">{{ displayLanguage }}</div>

    <!-- 仅激活+悬停时显示的下拉选择器（离屏时不挂载） -->
    <div v-if="blockActivation.isUiActive.value" class="language-selector-container" contenteditable="false" ref="selectorContainerRef">
      <!-- 现在这是唯一的触发器 - 一个纯粹的视觉元素 -->
      <div
        class="language-selector"
        @click.stop.prevent="openCustomMenu"
        :title="editorMessage('editor.codeBlock.language.select')"
        ref="languageSelectorRef"
      >
        <span>{{ displayLanguage }}</span>
        <ChevronIcon direction="down" class="chevron-icon" :class="{ 'is-open': isCustomMenuOpen }" />
      </div>
    </div>

    <!-- 使用Teleport将菜单传送到body，避免任何层叠上下文问题 -->
    <Teleport to="body">
      <transition name="dropdown-fade">
        <CustomSelect
          v-if="isCustomMenuOpen"
          ref="customSelectRef"
          :modelValue="node.attrs.language || 'plaintext'"
          :options="languageOptions"
          :manualMode="true"
          :variant="'minimal'"
          :fontSize="'0.8rem'"
          @update:modelValue="handleLanguageUpdate"
          @close="closeCustomMenu"
          class="custom-language-select"
          :style="{
            position: 'fixed',
            top: menuPosition.top + 'px',
            left: menuPosition.left + 'px',
            width: 'auto', /* 覆盖组件内部的 width: 100% */
            zIndex: 9999
          }"
        />
      </transition>
    </Teleport>

    <div v-if="blockActivation.isUiActive.value" class="code-block-controls" contenteditable="false">
      <button
        class="copy-button"
        type="button"
        @click="copyCode"
        :title="editorMessage('editor.codeBlock.action.copy')"
        :aria-label="editorMessage('editor.codeBlock.action.copy')"
      >
        <CopyIcon />
      </button>
    </div>
    <div
      class="code-block editor-block"
      :data-node-type="'codeBlock'"
      :data-type="'code-block'"
      :data-block-id="node.attrs.id"
      :data-block-type="node.attrs.blockType"
      :data-is-empty="isEmpty ? 'true' : 'false'"
    >
      <pre :data-language="node.attrs.language || 'plaintext'" spellcheck="false"><code :class="`language-${node.attrs.language || 'plaintext'}`"><node-view-content /></code></pre>
    </div>
  </node-view-wrapper>
</template>

<script setup>
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3';
import { computed, ref, watch, onMounted, onBeforeUnmount, inject } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { useCurrentBlockActivation } from '../../../ui/composables/useCurrentBlockActivation';
import {
  dispatchNodeViewRenderVirtualizationKeepAlive,
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
} from '../../../features/RenderVirtualization';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { readCodeBlockLanguageOptions } from '../functions/codeBlockPresentation';

const props = defineProps(nodeViewProps);
const renderVirtualizationKeepAlivePort = inject(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, null);
const { editorMessage } = useEditorLocalization();

// 块激活状态：离屏时关闭 hover 控件，降低渲染成本
const blockActivation = useCurrentBlockActivation();

const customSelectRef = ref(null);
const nodeViewWrapperRef = ref(null);
const languageSelectorRef = ref(null);
const selectorContainerRef = ref(null);
const isCustomMenuOpen = ref(false);
const menuPosition = ref({ top: 0, left: 0, width: 0 });

// 定义语言选项数组，供 CustomSelect 使用
const languageOptions = computed(() => readCodeBlockLanguageOptions(editorMessage));

// 是否为空
const isEmpty = computed(() => {
  return props.node.textContent.length === 0;
});

// 打开/切换自定义菜单
const openCustomMenu = (event) => {
  // 如果菜单已经打开，则关闭它
  if (isCustomMenuOpen.value) {
    closeCustomMenu();
    return;
  }

  // --- 以下是菜单未打开时的打开逻辑 ---

  // 阻止事件冒泡，确保不会触发其他事件
  event.stopPropagation();
  event.preventDefault();

  // 获取语言选择器容器的位置信息，精确计算菜单显示位置
  const containerEl = selectorContainerRef.value;

  if (containerEl) {
    const containerRect = containerEl.getBoundingClientRect();

    menuPosition.value = {
      // 定位在language-selector-container的正下方
      top: containerRect.bottom,
      // 与language-selector-container左侧对齐
      left: containerRect.left,
      // 菜单宽度由其自身CSS控制，不再从触发器获取
      width: 0
    };
  }

  // 打开菜单
  isCustomMenuOpen.value = true;
};

// 关闭自定义菜单
const closeCustomMenu = () => {
  isCustomMenuOpen.value = false;
};

const setVirtualizationKeepAlive = (active) => {
  dispatchNodeViewRenderVirtualizationKeepAlive({
    target: nodeViewWrapperRef.value?.$el ?? null,
    editor: props.editor,
    getPos: props.getPos,
    reason: 'interaction-open',
    active,
    keepAlivePort: renderVirtualizationKeepAlivePort,
  });
};

// 添加全局ESC键关闭
const handleKeyDown = (e) => {
  if (e.key === 'Escape' && isCustomMenuOpen.value) {
    closeCustomMenu();
  }
};

// 组件挂载时添加键盘事件监听
onMounted(() => {
  document.addEventListener('keydown', handleKeyDown);
});

// 组件卸载时移除键盘事件监听
onBeforeUnmount(() => {
  setVirtualizationKeepAlive(false);
  document.removeEventListener('keydown', handleKeyDown);
});

watch(isCustomMenuOpen, (open) => {
  setVirtualizationKeepAlive(open);
});

// 处理语言更新
const handleLanguageUpdate = (newLangValue) => {
  // Tiptap 属性中，null 代表 plaintext
  const language = newLangValue === 'plaintext' ? null : newLangValue;
  props.updateAttributes({ language });
  // 选择后自动关闭菜单
  closeCustomMenu();
};

// 复制代码
const copyCode = (event) => {
  const code = props.node.textContent;
  if (code) {
    navigator.clipboard.writeText(code)
      .then(() => {
        // 可以显示一个临时复制成功提示
        const button = event.target.closest('.copy-button');
        if (button) {
        const originalTitle = button.getAttribute('title');
        button.setAttribute('title', editorMessage('editor.codeBlock.action.copied'));
        setTimeout(() => {
            if (button && button.isConnected) {
          button.setAttribute('title', originalTitle);
            }
        }, 2000);
        }
      })
      .catch(err => {
        console.error('复制失败:', err);
      });
  }
};

// 计算属性，用于显示更友好的语言名称
const displayLanguage = computed(() => {
  const lang = props.node.attrs.language;
  const found = languageOptions.value.find(opt => opt.value === (lang || 'plaintext'));
  return found ? found.text : (lang || editorMessage('editor.codeBlock.language.plainText'));
});
</script>
