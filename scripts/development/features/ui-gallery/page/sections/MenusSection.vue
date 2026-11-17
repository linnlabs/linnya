<script setup lang="ts">
import { ref } from 'vue';
import {
  ColorPickerPanel,
  CustomSelect,
  HoverTooltip,
  SimpleDatePicker,
  TextPopover,
  TimePicker,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import {
  CopyIcon,
  DeleteIcon,
  DocumentAddIcon,
  DuplicateIcon,
  EditIcon,
  ExternalLinkIcon,
  FolderIcon,
  InfoIcon,
  PinIcon,
} from '@linnya/renderer-ui/icons';
// 颜色面板用编辑器真实的块颜色色板与内容色 token，而不是另编一套示意色。
import '../../../../../../apps/renderer/domains/editor/styles/tokens/block-colors.css';
import {
  EDITOR_BLOCK_BACKGROUND_COLOR_OPTIONS,
  EDITOR_BLOCK_TEXT_COLOR_OPTIONS,
} from '../../../../../../apps/renderer/domains/editor/features/blockActionMenu/definitions/editorBlockColorPalette.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const model = ref('deepseek-v4');
const language = ref('zh-CN');
const sortBy = ref('modified');

const MODEL_OPTIONS: CustomSelectOption<string>[] = [
  { isGroup: true, label: '推荐' },
  { text: 'DeepSeek V4', value: 'deepseek-v4' },
  { text: 'GLM 5 Flash', value: 'glm-5-flash' },
  { isSeparator: true },
  { isGroup: true, label: '本地' },
  { text: 'Qwen 3 14B', value: 'qwen-3-14b' },
  { text: '未配置的模型', value: 'unconfigured', disabled: true, disabledReason: '需要先填写 API Key' },
];

const LANGUAGE_OPTIONS: CustomSelectOption<string>[] = [
  { text: '简体中文', value: 'zh-CN' },
  { text: 'English', value: 'en' },
  { text: '跟随系统', value: 'system' },
];

const SORT_OPTIONS: CustomSelectOption<string>[] = [
  { text: '最近修改', value: 'modified' },
  { text: '名称', value: 'name' },
  { text: '创建时间', value: 'created' },
];

const ACTION_MENU: CustomSelectOption<string>[] = [
  { text: '打开', value: 'open', iconComponent: ExternalLinkIcon, shortcut: '↵' },
  { text: '重命名', value: 'rename', iconComponent: EditIcon, shortcut: 'F2' },
  { text: '创建副本', value: 'duplicate', iconComponent: DuplicateIcon },
  { text: '复制链接', value: 'copy', iconComponent: CopyIcon, shortcut: '⌘C' },
  {
    text: '移动到',
    value: 'move',
    iconComponent: FolderIcon,
    children: [
      { text: '根目录', value: 'move-root' },
      { text: '报告', value: 'move-reports' },
      { text: '访谈纪要', value: 'move-interviews' },
    ],
  },
  { text: '固定到侧栏', value: 'pin', iconComponent: PinIcon, selected: true },
  { text: '新建子文档', value: 'new-child', iconComponent: DocumentAddIcon, disabled: true, disabledReason: '演示稿不能包含子文档' },
  { isSeparator: true },
  { text: '删除', value: 'delete', iconComponent: DeleteIcon, variant: 'danger' },
];

const date = ref<Date | null>(new Date(2026, 10, 17));
const time = ref<Date | null>(new Date(2026, 10, 17, 9, 30));
const textColor = ref<string | null>('blue_text');
const backgroundColor = ref<string | null>(null);
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="选择器">
      <GalleryRow label="分组 · 禁用原因">
        <CustomSelect v-model="model" class="gallery-field" :options="MODEL_OPTIONS" trigger-aria-label="模型" />
      </GalleryRow>
      <GalleryRow label="选中对勾">
        <CustomSelect v-model="language" class="menus__narrow" :options="LANGUAGE_OPTIONS" show-selected-checkmark trigger-aria-label="界面语言" />
      </GalleryRow>
      <GalleryRow label="无边框 · 禁用">
        <CustomSelect v-model="sortBy" class="menus__narrow" :options="SORT_OPTIONS" :bordered="false" trigger-aria-label="排序" />
        <CustomSelect v-model="sortBy" class="menus__narrow" :options="SORT_OPTIONS" disabled trigger-aria-label="排序（不可用）" />
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="动作菜单" note="静态展开，便于截图对比；删除类动作放在最后一组并标红。">
      <GalleryRow label="图标 · 快捷键 · 子菜单" align="start">
        <div class="menus__static">
          <CustomSelect
            :options="ACTION_MENU"
            semantic-role="menu"
            manual-mode
            :parent-is-open="true"
            options-max-height="none"
            trigger-aria-label="文件操作"
          />
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="提示与文字浮层">
      <GalleryRow label="HoverTooltip">
        <HoverTooltip text="悬停 500ms 后出现，相邻控件之间立即切换">
          <span class="menus__hover-target" tabindex="0">悬停或用 Tab 聚焦</span>
        </HoverTooltip>
      </GalleryRow>
      <GalleryRow label="TextPopover">
        <TextPopover content="引用来源：季度复盘.md 第 3 节。点击空白处关闭。" trigger-title="查看说明">
          <template #trigger>
            <InfoIcon class="menus__info" />
          </template>
        </TextPopover>
        <TextPopover content="悬停触发的文字浮层。" trigger-mode="hover" trigger-text="悬停查看" />
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="日期、时间与颜色">
      <GalleryRow label="日期与时间">
        <SimpleDatePicker v-model="date" placeholder="选择日期" />
        <TimePicker v-model="time" placeholder="选择时间" />
      </GalleryRow>
      <GalleryRow label="ColorPickerPanel" align="start">
        <div class="menus__panel">
          <ColorPickerPanel
            :text-colors="EDITOR_BLOCK_TEXT_COLOR_OPTIONS"
            :background-colors="EDITOR_BLOCK_BACKGROUND_COLOR_OPTIONS"
            :current-text-value="textColor"
            :current-background-value="backgroundColor"
            @select-text="color => (textColor = color.value)"
            @select-background="color => (backgroundColor = color.value)"
            @clear="textColor = null; backgroundColor = null"
          />
        </div>
      </GalleryRow>
    </GalleryBlock>
  </div>
</template>

<style>
.menus__narrow {
  width: 180px; /* scale-exempt: 版面尺寸 */
}

.menus__static {
  position: relative;
  width: 240px; /* scale-exempt: 版面尺寸 */
  min-height: 360px; /* scale-exempt: 版面尺寸 */
}

.menus__hover-target {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background-color: var(--color-bg-subtle);
  color: var(--color-text-secondary);
}

.menus__info {
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
}

.menus__panel {
  width: 280px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-floating-panel);
}
</style>
