<template>
  <ToolbarGroup class="text-selection-toolbar">
    <!-- 子组的分隔线由共享组件生成，避免 Editor 与插件维护两套间距。 -->
    <ToolbarGroup>
      <button
        class="ai-quote-button"
        @click="handleAiQuote"
      >
        <AiIcon class="ai-icon" />
        <span>{{ editorMessage('editor.floatingToolbar.aiReference') }}</span>
      </button>
    </ToolbarGroup>

    <!-- 文本格式化按钮组 -->
    <div class="format-buttons">
      <!-- 标题按钮容器 -->
      <div class="heading-button-container">
        <ToolbarButton
          ref="headingButtonRef"

          class="text-selection-heading-button"
          :active="isAnyHeadingActive || showHeadingDropdown"
          :aria-expanded="showHeadingDropdown"
          :label="currentHeadingText"
          @click="toggleHeadingDropdown"
        >
          <template v-if="currentHeadingLevel">
            <span class="heading-level">H{{ currentHeadingLevel }}</span>
          </template>
          <template v-else>
            <HeadingIcon class="format-icon" />
          </template>
          <ChevronIcon
            class="chevron-icon"
            direction="down"
          />
        </ToolbarButton>

        <!-- 标题下拉菜单 -->
        <transition name="heading-menu-fade">
          <div
            v-if="showHeadingDropdown"
            class="heading-select-wrapper"
          >
            <CustomSelect
              :model-value="currentHeadingLevel"
              :options="headingOptions"
              :manual-mode="true"
              variant="minimal"
              :bordered="false"
              :class-names="{ optionLabel: 'text-selection-heading-option-label' }"
              :parent-is-open="showHeadingDropdown"
              @update:model-value="handleHeadingSelect"
              @close="closeHeadingDropdown"
            />
          </div>
        </transition>
      </div>

      <!-- 加粗按钮 -->
      <ToolbarButton

        :active="isBoldActive"
        :label="editorMessage('editor.floatingToolbar.bold')"
        @click="toggleBold"
      >
        <BoldIcon class="format-icon" />
      </ToolbarButton>

      <!-- 斜体按钮 -->
      <ToolbarButton

        :active="isItalicActive"
        :label="editorMessage('editor.floatingToolbar.italic')"
        @click="toggleItalic"
      >
        <ItalicIcon class="format-icon" />
      </ToolbarButton>

      <!-- 删除线按钮 -->
      <ToolbarButton

        :active="isStrikethroughActive"
        :label="editorMessage('editor.floatingToolbar.strikethrough')"
        @click="toggleStrikethrough"
      >
        <StrikethroughIcon class="format-icon" />
      </ToolbarButton>

      <BaseDropdown
        :manual-mode="true"
        :is-open="showColorPanel"
        @open="toggleColorPanel"
        @close="closeInlineColorPicker"
      >
        <template #trigger="{ toggle }">
          <ToolbarColorButton
            kind="text"
            :color="currentTextColorCssValue"
            :expanded="showColorPanel"
            :label="editorMessage('editor.floatingToolbar.textColor')"
            @click="toggle"
          />
        </template>
        <template #content>
          <DropdownPanel
            :show="showColorPanel"
            class="text-selection-color-panel"
          >
            <InlineTextColorPicker
              :model-value="currentTextColor"
              :has-color="selectionHasTextColor"
              :title="editorMessage('editor.floatingToolbar.textColor')"
              :clear-label="editorMessage('editor.floatingToolbar.clearColor')"
              :text-colors="textColors"
              @update:model-value="handleInlineColorChange"
              @select="commitInlineColor"
              @clear="clearInlineColor"
            />
          </DropdownPanel>
        </template>
      </BaseDropdown>
      <BaseDropdown
        :manual-mode="true"
        :is-open="showHighlightPanel"
        @open="toggleHighlightPanel"
        @close="closeInlineHighlightPicker"
      >
        <template #trigger="{ toggle }">
          <ToolbarColorButton
            kind="background"
            :color="currentHighlightCssValue"
            :expanded="showHighlightPanel"
            :label="editorMessage('editor.floatingToolbar.textHighlight')"
            @click="toggle"
          />
        </template>
        <template #content>
          <DropdownPanel
            :show="showHighlightPanel"
            class="text-selection-color-panel"
          >
            <InlineTextHighlightPicker
              :model-value="currentTextHighlight"
              :has-highlight="selectionHasTextHighlight"
              :title="editorMessage('editor.floatingToolbar.textHighlight')"
              :clear-label="editorMessage('editor.floatingToolbar.clearHighlight')"
              :highlight-colors="highlightColors"
              @update:model-value="handleInlineHighlightChange"
              @select="commitInlineHighlight"
              @clear="clearInlineHighlight"
            />
          </DropdownPanel>
        </template>
      </BaseDropdown>
    </div>
  </ToolbarGroup>
</template>

<script setup>
import { BaseDropdown, DropdownPanel, ToolbarColorButton, ToolbarButton, ToolbarGroup } from '@linnya/renderer-ui';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { AiIcon } from '@linnya/renderer-ui/icons';
import { BoldIcon } from '@linnya/renderer-ui/icons';
import { ItalicIcon } from '@linnya/renderer-ui/icons';
import { StrikethroughIcon } from '@linnya/renderer-ui/icons';
import { HeadingIcon } from '@linnya/renderer-ui/icons';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import InlineTextColorPicker from './InlineTextColorPicker.vue';
import InlineTextHighlightPicker from './InlineTextHighlightPicker.vue';
import { addComposerReference } from '@plugin/renderer/composerCommandPort';
import { useNotificationStore } from '@/app/notification';
import * as ConversionCommands from '../../../extensions/core/commands/ConversionCommands';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import {
  readFloatingToolbarHeadingOptions,
  readFloatingToolbarHighlightColors,
  readFloatingToolbarTextColors,
} from '../functions/floatingToolbarPresentation';

const props = defineProps({
  editor: {
    type: Object,
    default: null,
  },
});

const editor = computed(() => props.editor);
const notificationStore = useNotificationStore();
const { editorMessage } = useEditorLocalization();

// 下拉菜单状态
const showHeadingDropdown = ref(false);
const headingButtonRef = ref(null);
const showColorPanel = ref(false);
const currentTextColor = ref(null);
// 当前选区是否包含任意文字颜色标记，用于控制「清除颜色」按钮可用状态
const selectionHasTextColor = ref(false);

const showHighlightPanel = ref(false);
const currentTextHighlight = ref(null);
// 当前选区是否包含任意文字高亮标记，用于控制「清除高亮」按钮可用状态
const selectionHasTextHighlight = ref(false);

const headingOptions = computed(() => readFloatingToolbarHeadingOptions(editorMessage));

const textColors = computed(() => readFloatingToolbarTextColors(editorMessage));
const highlightColors = computed(() => readFloatingToolbarHighlightColors(editorMessage));

let detachSelectionUpdateListener = null;

// 检查加粗是否激活
const isBoldActive = computed(() => {
  return editor.value?.isActive('bold') ?? false;
});

// 检查斜体是否激活
const isItalicActive = computed(() => {
  return editor.value?.isActive('italic') ?? false;
});

// 检查删除线是否激活
const isStrikethroughActive = computed(() => {
  return editor.value?.isActive('strike') ?? false;
});

// 检查是否有任意级别的标题激活
const isAnyHeadingActive = computed(() => {
  return editor.value?.isActive('headingBlock') ?? false;
});

// 获取当前标题级别
const currentHeadingLevel = computed(() => {
  if (!editor.value) return null;
  for (let level = 1; level <= 6; level++) {
    if (editor.value.isActive('headingBlock', { level })) {
      return level;
    }
  }
  return null;
});

// 获取当前标题文本（用于按钮提示）
const currentHeadingText = computed(() => {
  if (currentHeadingLevel.value) {
    return editorMessage('editor.floatingToolbar.headingWithLevel', { level: currentHeadingLevel.value });
  }
  return editorMessage('editor.floatingToolbar.heading');
});

// 切换加粗
const toggleBold = () => {
  if (editor.value) {
    editor.value.chain().focus().toggleBold().run();
  }
};

// 切换斜体
const toggleItalic = () => {
  if (editor.value) {
    editor.value.chain().focus().toggleItalic().run();
  }
};

// 切换删除线
const toggleStrikethrough = () => {
  if (editor.value) {
    editor.value.chain().focus().toggleStrike().run();
  }
};

// 切换颜色面板
const toggleColorPanel = () => {
  showColorPanel.value = !showColorPanel.value;
  if (showColorPanel.value) {
    syncCurrentTextColor();
  }
};

// 同步当前选区颜色：用于更新工具栏「A」图标和清除按钮状态
const syncCurrentTextColor = () => {
  if (!editor.value) {
    currentTextColor.value = null;
    selectionHasTextColor.value = false;
    return;
  }

  const { state } = editor.value;
  const { selection } = state;
  const from = selection?.from ?? null;
  const to = selection?.to ?? null;

  if (from == null || to == null) {
    currentTextColor.value = null;
    selectionHasTextColor.value = false;
    return;
  }

  // 情况 1：折叠光标，优先读取 storedMarks / 光标所在位置的 mark
  if (selection.empty) {
    const marks = state.storedMarks || selection.$from.marks();
    const textColorMark = marks?.find(mark => mark.type.name === 'textColor');
    if (textColorMark) {
      currentTextColor.value = textColorMark.attrs.color || null;
      selectionHasTextColor.value = true;
      return;
    }
  }

  // 情况 2：非折叠选区，或者光标没有 pending mark：
  // 扫描整个选区，统计所有出现过的 textColor 颜色值（包括无色状态）
  const colorSet = new Set();
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;

    const textColorMark = node.marks && node.marks.find(mark => mark.type.name === 'textColor');
    if (textColorMark && textColorMark.attrs?.color) {
      colorSet.add(textColorMark.attrs.color);
    } else {
      // 记录无色状态
      colorSet.add(null);
    }
    return;
  });

  // colorSet 中包含所有颜色值（可能有 null，表示无色）

  // 计算是否允许清除：只要有任意非 null 的颜色，就允许清除
  let hasAnyColor = false;
  for (const c of colorSet) {
    if (c !== null) {
      hasAnyColor = true;
      break;
    }
  }
  selectionHasTextColor.value = hasAnyColor;

  if (colorSet.size === 0) {
    // 理论上不太可能（只要有文本节点就会有记录），防守一下
    currentTextColor.value = null;
    return;
  }

  if (colorSet.size === 1) {
    // 只有一种状态
    const [onlyState] = Array.from(colorSet);
    // 如果是 null (纯无色)，currentTextColor = null
    // 如果是 'red' (纯红色)，currentTextColor = 'red'
    currentTextColor.value = onlyState;
  } else {
    // 多种状态（例如：红+蓝，或者 红+无色），统一回退为默认色
    currentTextColor.value = null;
  }
};

// 同步当前选区高亮：用于更新工具栏高亮指示器和清除按钮状态
const syncCurrentTextHighlight = () => {
  if (!editor.value) {
    currentTextHighlight.value = null;
    selectionHasTextHighlight.value = false;
    return;
  }

  const { state } = editor.value;
  const { selection } = state;
  const from = selection?.from ?? null;
  const to = selection?.to ?? null;

  if (from == null || to == null) {
    currentTextHighlight.value = null;
    selectionHasTextHighlight.value = false;
    return;
  }

  // 情况 1：折叠光标，优先读取 storedMarks / 光标所在位置的 mark
  if (selection.empty) {
    const marks = state.storedMarks || selection.$from.marks();
    const highlightMark = marks?.find(mark => mark.type.name === 'textHighlight');
    if (highlightMark) {
      currentTextHighlight.value = highlightMark.attrs.color || null;
      selectionHasTextHighlight.value = true;
      return;
    }
  }

  // 情况 2：非折叠选区，或者光标没有 pending mark：
  // 扫描整个选区，统计所有出现过的 textHighlight 颜色值（包括无高亮状态）
  const highlightSet = new Set();
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;

    const highlightMark = node.marks && node.marks.find(mark => mark.type.name === 'textHighlight');
    if (highlightMark && highlightMark.attrs?.color) {
      highlightSet.add(highlightMark.attrs.color);
    } else {
      // 记录无高亮状态
      highlightSet.add(null);
    }
    return;
  });

  // 计算是否允许清除：只要有任意非 null 的高亮，就允许清除
  let hasAnyHighlight = false;
  for (const h of highlightSet) {
    if (h !== null) {
      hasAnyHighlight = true;
      break;
    }
  }
  selectionHasTextHighlight.value = hasAnyHighlight;

  if (highlightSet.size === 0) {
    currentTextHighlight.value = null;
    return;
  }

  if (highlightSet.size === 1) {
    // 只有一种状态
    const [onlyState] = Array.from(highlightSet);
    currentTextHighlight.value = onlyState;
  } else {
    // 多种状态，统一回退为默认
    currentTextHighlight.value = null;
  }
};

// 处理颜色变化（实时更新 UI 状态）
const handleInlineColorChange = (value) => {
  currentTextColor.value = value;
};

// 应用颜色
const commitInlineColor = (value) => {
  if (!editor.value) return;
  editor.value.chain().focus().setTextColor(value).run();
  closeInlineColorPicker();
};

// 清除颜色
const clearInlineColor = () => {
  if (!editor.value) return;
  editor.value.chain().focus().setTextColor(null).run();
  currentTextColor.value = null;
  closeInlineColorPicker();
};

// 关闭颜色选择面板，集中管理关闭逻辑
const closeInlineColorPicker = () => {
  showColorPanel.value = false;
};

// 处理高亮变化（实时更新 UI 状态）
const handleInlineHighlightChange = (value) => {
  currentTextHighlight.value = value;
};

// 应用高亮
const commitInlineHighlight = (value) => {
  if (!editor.value) return;
  editor.value.chain().focus().setTextHighlight(value).run();
  closeInlineHighlightPicker();
};

// 清除高亮
const clearInlineHighlight = () => {
  if (!editor.value) return;
  editor.value.chain().focus().setTextHighlight(null).run();
  currentTextHighlight.value = null;
  closeInlineHighlightPicker();
};

// 关闭高亮选择面板
const closeInlineHighlightPicker = () => {
  showHighlightPanel.value = false;
};

// 切换高亮面板
const toggleHighlightPanel = () => {
  showHighlightPanel.value = !showHighlightPanel.value;
  if (showHighlightPanel.value) {
    syncCurrentTextHighlight();
  }
};

// 计算器件小圆点颜色（如果为空则使用默认 Secondary 颜色）
const currentTextColorCssValue = computed(() => {
  if (!currentTextColor.value) {
    return 'var(--color-text-secondary)';
  }
  const blockTextTokenPrefix = '--block-text-';
  const raw = currentTextColor.value.endsWith('_text')
    ? currentTextColor.value.slice(0, -'_text'.length)
    : currentTextColor.value;
  return `var(${blockTextTokenPrefix}${raw})`;
});

// 计算高亮器件小圆点背景色（与 TextHighlightMark 的渲染逻辑保持一致）
const currentHighlightCssValue = computed(() => {
  if (!currentTextHighlight.value) {
    return 'var(--color-text-secondary)';
  }
  const raw = String(currentTextHighlight.value);

  let cssVarName;
  let mixRatio = '20%'; // 默认与面板一致：20% 颜色 + 80% 透明

  if (raw.startsWith('bright_')) {
    // 高亮色：使用 --highlight-bright-* 变量
    const colorName = raw.slice('bright_'.length);
    cssVarName = `--highlight-bright-${colorName}`;
    // 整体提升高亮色的混合比例，实现高饱和度荧光效果
    // 黄色特判：为了达到 Word 荧光黄效果，给予更高的不透明度 (60%)
    // 其他亮色：50%
    mixRatio = colorName === 'yellow' ? '60%' : '50%';
  } else if (raw.endsWith('_text')) {
    // 普通文字色：去掉 '_text' 后缀，使用 --block-text-*
    const colorKey = raw.slice(0, -'_text'.length);
    cssVarName = `--block-text-${colorKey}`;
    mixRatio = '20%';
  } else {
    // 兜底：尝试按 block-text 变量处理
    cssVarName = `--block-text-${raw}`;
  }

  return `color-mix(in srgb, var(${cssVarName}) ${mixRatio}, transparent)`;
});

const cleanupEditorSelectionListener = () => {
  if (typeof detachSelectionUpdateListener === 'function') {
    detachSelectionUpdateListener();
    detachSelectionUpdateListener = null;
  }
};

const setupEditorSelectionListener = () => {
  cleanupEditorSelectionListener();
  const currentEditor = editor.value;
  if (!currentEditor || typeof currentEditor.on !== 'function') {
    return;
  }
  const handleSelectionUpdate = () => {
    syncCurrentTextColor();
    syncCurrentTextHighlight();
    closeInlineColorPicker();
    closeInlineHighlightPicker();
  };
  currentEditor.on('selectionUpdate', handleSelectionUpdate);
  // Tiptap on 返回 Editor 本身；必须用同一 callback 解除旧文稿订阅。
  detachSelectionUpdateListener = () => currentEditor.off('selectionUpdate', handleSelectionUpdate);
};

watch(
  editor,
  () => {
    setupEditorSelectionListener();
    syncCurrentTextColor();
    syncCurrentTextHighlight();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  cleanupEditorSelectionListener();
});

// 切换标题下拉菜单显示/隐藏
const toggleHeadingDropdown = () => {
  showHeadingDropdown.value = !showHeadingDropdown.value;
};

// 选择标题级别
const selectHeadingLevel = (level) => {
  if (!editor.value) return;

  // 检查命令是否存在
  if (typeof ConversionCommands.convertToHeading !== 'function' ||
      typeof ConversionCommands.setBaseBlock !== 'function') {
    console.error('[TextSelectionToolbar] ConversionCommands 不可用');
    return;
  }

  if (level === null) {
    // 转换为普通文本
    ConversionCommands.setBaseBlock()({
      state: editor.value.state,
      dispatch: editor.value.view.dispatch
    });
  } else {
    // 转换为指定级别的标题
    ConversionCommands.convertToHeading(level)({
      state: editor.value.state,
      dispatch: editor.value.view.dispatch
    });
  }

  // 关闭下拉菜单
  showHeadingDropdown.value = false;

  // 重新聚焦编辑器
  editor.value.commands.focus();
};

const handleHeadingSelect = (value) => {
  const normalizedValue = typeof value === 'number' ? value : null;
  selectHeadingLevel(normalizedValue);
};

const closeHeadingDropdown = () => {
  showHeadingDropdown.value = false;
};

const handleAiQuote = () => {
  const ed = editor.value;
  if (!ed) {
    console.warn('[TextSelectionToolbar] editor 不可用，无法采集引用');
    return;
  }

  const { state } = ed;
  const { selection } = state;
  if (!selection || selection.empty) {
    notificationStore.show(editorMessage('editor.floatingToolbar.toast.noSelection'), 'warning', 2500);
    return;
  }

  const { from, to } = selection;
  const rawText = state.doc.textBetween(from, to, '\n');
  const text = rawText.trim();

  if (!text) {
    notificationStore.show(editorMessage('editor.floatingToolbar.toast.emptySelection'), 'warning', 2500);
    return;
  }

  // 生成引用预览文案：「开头片段 … 结尾片段」
  const MAX_PREVIEW_LENGTH = 60;
  const EDGE_LENGTH = 24;
  let previewText = text;

  if (text.length > MAX_PREVIEW_LENGTH) {
    const head = text.slice(0, EDGE_LENGTH);
    const tail = text.slice(-EDGE_LENGTH);
    previewText = `${head} … ${tail}`;
  }

  addComposerReference({
    text,
    pluginId: 'platform',
    kind: 'text-selection',
    // 预留 source 元数据字段，后续可以补充 docId/blockId/offset 等信息
    previewText,
    source: {},
  });

  notificationStore.show(editorMessage('editor.floatingToolbar.toast.addedReference'), 'success', 2200);
};
</script>
