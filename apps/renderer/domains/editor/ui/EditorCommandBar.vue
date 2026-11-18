<template>
  <CommandBar
    v-if="editor"
    class="editor-command-bar"
    :aria-label="editorMessage('editor.menu.label')"
  >
    <ToolbarGroup>
      <div class="editor-command-bar__anchor">
        <ToolbarButton
          :active="isAnyHeadingActive || openMenu === 'heading'"
          :aria-expanded="openMenu === 'heading'"
          :disabled="isInTable"
          :label="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.headingLevel')"
          :data-linnya-tooltip="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.headingLevel')"
          @click="toggleMenu('heading')"
        >
          <span v-if="currentHeadingLevel" class="editor-command-bar__level">H{{ currentHeadingLevel }}</span>
          <HeadingIcon v-else />
          <ChevronIcon class="editor-command-bar__chevron" direction="down" />
        </ToolbarButton>
        <transition name="editor-command-bar-menu">
          <div v-if="openMenu === 'heading'" class="editor-command-bar__menu">
            <CustomSelect
              :model-value="currentHeadingLevel"
              :options="headingOptions"
              :manual-mode="true"
              variant="minimal"
              :bordered="false"
              :parent-is-open="true"
              @update:model-value="selectHeading"
              @close="closeMenu"
            />
          </div>
        </transition>
      </div>
    </ToolbarGroup>

    <ToolbarGroup>
      <div class="editor-command-bar__anchor">
        <ToolbarButton
          :active="isListActive || openMenu === 'list'"
          :aria-expanded="openMenu === 'list'"
          :disabled="isInTable"
          :label="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.list')"
          :data-linnya-tooltip="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.list')"
          @click="toggleMenu('list')"
        >
          <NumberedListIcon v-if="activeListType === 'ordered'" />
          <BulletListIcon v-else />
          <ChevronIcon class="editor-command-bar__chevron" direction="down" />
        </ToolbarButton>
        <transition name="editor-command-bar-menu">
          <div v-if="openMenu === 'list'" class="editor-command-bar__menu">
            <CustomSelect
              :model-value="activeListType"
              :options="listOptions"
              :manual-mode="true"
              variant="minimal"
              :bordered="false"
              :parent-is-open="true"
              @update:model-value="toggleListItem"
              @close="closeMenu"
            />
          </div>
        </transition>
      </div>
      <ToolbarButton
        :active="editor.isActive('quoteBlock')"
        :disabled="isInTable"
        :label="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.quoteBlock')"
        :data-linnya-tooltip="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.quoteBlock')"
        @click="toggleQuoteBlock"
      >
        <QuoteIcon />
      </ToolbarButton>
    </ToolbarGroup>

    <ToolbarGroup>
      <ToolbarButton
        :label="editorMessage('editor.menu.insertImage')"
        :data-linnya-tooltip="editorMessage('editor.menu.insertImage')"
        @click="insertImage"
      >
        <ImageIcon />
      </ToolbarButton>
      <div class="editor-command-bar__anchor">
        <ToolbarButton
          :active="openMenu === 'table'"
          :aria-expanded="openMenu === 'table'"
          :disabled="isInTable"
          :label="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.insertTable')"
          :data-linnya-tooltip="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.insertTable')"
          @click="toggleMenu('table')"
        >
          <TableIcon />
        </ToolbarButton>
        <transition name="editor-command-bar-menu">
          <div v-if="openMenu === 'table'" class="editor-command-bar__menu">
            <TableSizeSelector @confirm="insertTable" @cancel="closeMenu" />
          </div>
        </transition>
      </div>
    </ToolbarGroup>

    <ToolbarGroup>
      <div class="editor-command-bar__anchor">
        <ToolbarButton
          :active="openMenu === 'more'"
          :aria-expanded="openMenu === 'more'"
          :label="editorMessage('editor.menu.moreInserts')"
          :data-linnya-tooltip="editorMessage('editor.menu.moreInserts')"
          @click="toggleMenu('more')"
        >
          <MoreIcon direction="horizontal" />
        </ToolbarButton>
        <transition name="editor-command-bar-menu">
          <div v-if="openMenu === 'more'" class="editor-command-bar__menu editor-command-bar__menu--end">
            <CustomSelect
              :model-value="null"
              :options="moreOptions"
              :manual-mode="true"
              variant="minimal"
              :bordered="false"
              :parent-is-open="true"
              @update:model-value="runMoreItem"
              @close="closeMenu"
            />
          </div>
        </transition>
      </div>
    </ToolbarGroup>
  </CommandBar>
</template>

<script setup>
import { computed, ref } from 'vue';
import { CommandBar, CustomSelect, ToolbarButton, ToolbarGroup } from '@linnya/renderer-ui';
import {
  BulletListIcon,
  ChevronIcon,
  HeadingIcon,
  ImageIcon,
  MoreIcon,
  NumberedListIcon,
  QuoteIcon,
  TableIcon,
} from '@linnya/renderer-ui/icons';
import { useUIStore } from '../../../shared/stores/ui';
import { useNotificationStore } from '@/app/notification';
import { convertToListItem, convertToQuoteBlock, isInsideTable, setBaseBlock } from '../extensions/core/commands/ConversionCommands';
import { applyHeadingLevel } from '../orchestration/applyHeadingLevel';
import { readFloatingToolbarHeadingOptions } from '../features/floating-toolbar/functions/floatingToolbarPresentation';
import { createSlashMenuItems } from '../features/SlashMenu/definitions/slashMenuItems';
import TableSizeSelector from '../blocks/TableBlock/ui/TableSizeSelector.vue';
import { pickEmbedAndInsertImage } from '../blocks/ImageBlock/orchestration/embedAndInsertImage';
import { useEditorLocalization } from './useEditorLocalization';

/**
 * Markdown 文档顶部居中的悬浮命令条：标题 ▾ | 列表 ▾ 引用 | 图片 表格 | …。
 * 粗体、斜体交给选区工具条与快捷键；“…”列出斜杠菜单里命令条上没有的条目，与斜杠菜单同一份清单。
 */

/** 命令条上已有直接入口的斜杠条目，不在“…”里重复。 */
const ITEMS_ON_BAR = new Set(['heading1', 'heading2', 'bulletList', 'orderedList', 'quoteBlock', 'tableBlock', 'imageBlock']);

const uiStore = useUIStore();
const notificationStore = useNotificationStore();
const { editorMessage } = useEditorLocalization();

const editor = computed(() => uiStore.getEditor());
const openMenu = ref(null);

const isInTable = computed(() => (editor.value?.state ? isInsideTable(editor.value.state) : false));
const isAnyHeadingActive = computed(() => editor.value?.isActive('headingBlock') ?? false);
const currentHeadingLevel = computed(() => {
  if (!editor.value) return null;
  for (let level = 1; level <= 6; level += 1) {
    if (editor.value.isActive('headingBlock', { level })) return level;
  }
  return null;
});
const activeListType = computed(() => {
  if (editor.value?.isActive('listItemBlock', { listType: 'ordered' })) return 'ordered';
  if (editor.value?.isActive('listItemBlock', { listType: 'bullet' })) return 'bullet';
  return null;
});
const isListActive = computed(() => activeListType.value !== null);

const headingOptions = computed(() => readFloatingToolbarHeadingOptions(editorMessage));
const listOptions = computed(() => [
  { value: 'bullet', text: editorMessage('editor.menu.bulletList') },
  { value: 'ordered', text: editorMessage('editor.menu.orderedList') },
]);

const slashMenu = computed(() => createSlashMenuItems(editorMessage));
const moreOptions = computed(() => {
  const { items, groupOrder } = slashMenu.value;
  const options = [];
  for (const group of groupOrder) {
    const groupItems = items.filter(item => item.group === group && !ITEMS_ON_BAR.has(item.id));
    if (!groupItems.length) continue;
    if (options.length) options.push({ isSeparator: true, value: null, text: '' });
    options.push({ isGroup: true, label: group });
    for (const item of groupItems) options.push({ value: item.id ?? item.title, text: item.title });
  }
  return options;
});

function toggleMenu(menu) {
  openMenu.value = openMenu.value === menu ? null : menu;
}

function closeMenu() {
  openMenu.value = null;
}

function dispatchConversion(command) {
  command({ state: editor.value.state, dispatch: editor.value.view.dispatch });
  editor.value.commands.focus();
}

function selectHeading(value) {
  if (editor.value) applyHeadingLevel(editor.value, typeof value === 'number' ? value : null);
  closeMenu();
}

/** 选中当前已是的列表类型时转回正文，否则转换为该类型。 */
function toggleListItem(listType) {
  if (editor.value && (listType === 'bullet' || listType === 'ordered')) {
    dispatchConversion(activeListType.value === listType ? setBaseBlock() : convertToListItem(listType));
  }
  closeMenu();
}

function toggleQuoteBlock() {
  if (editor.value) dispatchConversion(convertToQuoteBlock());
}

function insertTable({ rows, cols, withHeaderRow }) {
  editor.value?.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
  closeMenu();
}

async function insertImage() {
  if (!editor.value) {
    notificationStore.show(editorMessage('editor.menu.toast.editorNotReady'), 'error');
    return;
  }
  await pickEmbedAndInsertImage({
    editor: editor.value,
    dialogTitle: editorMessage('editor.menu.imageDialog.title'),
    imageFilterName: editorMessage('editor.menu.imageDialog.filterName'),
    insertedMessageKey: 'editor.menu.toast.imageInserted',
    unavailableMessageKey: 'editor.menu.toast.imageDialogUnavailable',
    failedMessageKey: 'editor.menu.toast.imageFlowFailed',
  });
}

/** 从命令条执行斜杠条目：光标处的空范围代替斜杠触发文本。 */
function runMoreItem(id) {
  const item = slashMenu.value.items.find(candidate => (candidate.id ?? candidate.title) === id);
  closeMenu();
  if (!item || !editor.value) return;
  const { from } = editor.value.state.selection;
  void item.command({ editor: editor.value, range: { from, to: from } });
}
</script>
