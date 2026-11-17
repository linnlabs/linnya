<script setup lang="ts">
import { ref } from 'vue';
import {
  BaseDropdown,
  ColorPickerPanel,
  CustomSelect,
  DropdownPanel,
  ToolbarButton,
  ToolbarColorButton,
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
  MoreIcon,
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
const dropdownTextColor = ref<string | null>('red_text');

function blockTextColor(value: string | null): string {
  const option = EDITOR_BLOCK_TEXT_COLOR_OPTIONS.find(candidate => candidate.value === value);
  return option ? `var(${option.cssVar}, ${option.fallbackHex})` : 'var(--color-text-primary)';
}
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
      <GalleryRow label="展开的列表" align="start">
        <div class="menus__static menus__static--select">
          <CustomSelect
            v-model="model"
            :options="MODEL_OPTIONS"
            manual-mode
            :parent-is-open="true"
            show-selected-checkmark
            options-max-height="none"
            trigger-aria-label="模型（展开）"
          />
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="下拉面板" note="BaseDropdown 管开合与点外部关闭，DropdownPanel 是面板外观；Editor 取色、Slides 属性、用量浮层都由它们组合。">
      <GalleryRow label="点击打开">
        <BaseDropdown class="menus__dropdown-anchor">
          <template #trigger="{ toggle, isOpen }">
            <ToolbarColorButton
              label="文字颜色"
              kind="text"
              :color="blockTextColor(dropdownTextColor)"
              :expanded="isOpen"
              @click="toggle"
            />
          </template>
          <template #content="{ isOpen, close }">
            <DropdownPanel :show="isOpen" class="menus__dropdown">
              <ColorPickerPanel
                :show-background="false"
                :text-colors="EDITOR_BLOCK_TEXT_COLOR_OPTIONS"
                :current-text-value="dropdownTextColor"
                @select-text="color => { dropdownTextColor = color.value; close(); }"
                @clear="dropdownTextColor = null; close()"
              />
            </DropdownPanel>
          </template>
        </BaseDropdown>
      </GalleryRow>
      <GalleryRow label="静态展开" align="start">
        <div class="menus__static menus__static--panel">
          <ToolbarButton label="更多" :active="true"><MoreIcon /></ToolbarButton>
          <DropdownPanel :show="true" class="menus__dropdown menus__dropdown--text">
            <p class="menus__dropdown-title">上下文用量</p>
            <p class="menus__dropdown-body">已用 38%，约 48k / 128k tokens。接近上限时会自动压缩较早的对话。</p>
          </DropdownPanel>
        </div>
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

.menus__static--select {
  width: 280px; /* scale-exempt: 版面尺寸 */
  min-height: 280px; /* scale-exempt: 版面尺寸 */
}

.menus__static--panel {
  z-index: 0;
  min-height: 140px; /* scale-exempt: 版面尺寸 */
}

/* 点开的面板要盖住下面一行的静态面板：两者 z-index 相同，这里各自建层叠上下文并让上面一行在前。 */
.menus__dropdown-anchor {
  position: relative;
  z-index: 1;
}

.menus__dropdown {
  top: calc(100% + var(--space-1));
  left: 0;
}

.menus__static--panel .menus__dropdown {
  top: 32px; /* scale-exempt: 触发按钮 28px + 4px 间距 */
}

.menus__dropdown--text {
  width: 260px; /* scale-exempt: 版面尺寸 */
  padding: var(--space-3) var(--space-4);
}

.menus__dropdown-title {
  margin: 0 0 var(--space-1);
  font-weight: var(--font-weight-semibold);
}

.menus__dropdown-body {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
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
  width: fit-content;
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-floating-panel);
}
</style>
