<script setup lang="ts">
import { ActionButtons, BaseButton, IconButton } from '@linnya/renderer-ui';
import type { BaseButtonTone, BaseButtonVariant } from '@linnya/renderer-ui';
import {
  AddIcon,
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  FullscreenIcon,
  MoreIcon,
  RefreshIcon,
  SettingsIcon,
  UploadIcon,
} from '@linnya/renderer-ui/icons';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const VARIANTS: readonly { variant: BaseButtonVariant; text: string; use: string }[] = [
  { variant: 'primary', text: '保存', use: '区域内唯一的主操作' },
  { variant: 'secondary', text: '取消', use: '与主操作并列的次操作' },
  { variant: 'ghost', text: '重置', use: '容器内的次要操作' },
  { variant: 'plain', text: '更多选项', use: '工具栏、标题行的轻操作' },
  { variant: 'danger', text: '删除项目', use: '不可撤销的操作' },
  { variant: 'soft', text: '开始', use: '推荐但不抢主操作' },
  { variant: 'tint', text: '添加模型', use: '占满宽度的主操作' },
  { variant: 'outline', text: '新建知识库', use: '页面级入口' },
];

const OUTLINE_TONES: readonly { tone: BaseButtonTone; text: string }[] = [
  { tone: 'accent', text: '新建' },
  { tone: 'info', text: '导入文件' },
  { tone: 'neutral', text: '打开项目' },
  { tone: 'danger', text: '清空回收站' },
];

const PLAIN_TONES: readonly { tone: BaseButtonTone; text: string }[] = [
  { tone: 'neutral', text: '取消' },
  { tone: 'accent', text: '插入' },
  { tone: 'info', text: '同步' },
  { tone: 'danger', text: '移除' },
];

const ICON_SIZES = ['xs', 'sm', 'md', 'lg'] as const;
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="BaseButton 层级" note="variant 表达操作在区域里的层级，而不是想要什么颜色。">
      <GalleryRow v-for="item in VARIANTS" :key="item.variant" :label="`${item.variant} · ${item.use}`">
        <BaseButton :variant="item.variant" size="sm">{{ item.text }}</BaseButton>
        <BaseButton :variant="item.variant" size="md">{{ item.text }}</BaseButton>
        <BaseButton :variant="item.variant" size="lg">{{ item.text }}</BaseButton>
        <BaseButton :variant="item.variant" size="md" disabled>{{ item.text }}</BaseButton>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="色调与形状">
      <GalleryRow label="outline 色调">
        <BaseButton v-for="item in OUTLINE_TONES" :key="item.tone" variant="outline" :tone="item.tone" size="lg" shape="pill">
          <template #icon><AddIcon v-if="item.tone === 'accent'" /><UploadIcon v-else-if="item.tone === 'info'" /><DeleteIcon v-else-if="item.tone === 'danger'" /><SettingsIcon v-else /></template>
          {{ item.text }}
        </BaseButton>
      </GalleryRow>
      <GalleryRow label="plain 色调">
        <BaseButton v-for="item in PLAIN_TONES" :key="item.tone" variant="plain" :tone="item.tone" size="sm">{{ item.text }}</BaseButton>
      </GalleryRow>
      <GalleryRow label="带图标">
        <BaseButton variant="primary" size="md"><template #icon><AddIcon /></template>新建对话</BaseButton>
        <BaseButton variant="secondary" size="md"><template #icon><DownloadIcon /></template>导出</BaseButton>
        <BaseButton variant="ghost" size="md"><template #icon><RefreshIcon /></template>重新生成</BaseButton>
      </GalleryRow>
      <GalleryRow label="占满宽度">
        <div class="gallery-field gallery-stack">
          <BaseButton variant="tint" size="lg" block>添加模型</BaseButton>
          <BaseButton variant="outline" tone="accent" size="lg" block><template #icon><AddIcon /></template>新建知识库</BaseButton>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="IconButton" note="静止为三级文字色，悬停提亮并出现底色；active 用强调色浅底。">
      <GalleryRow v-for="size in ICON_SIZES" :key="size" :label="`${size}`">
        <IconButton :size="size" label="复制"><CopyIcon /></IconButton>
        <IconButton :size="size" label="刷新"><RefreshIcon /></IconButton>
        <IconButton :size="size" label="更多操作"><MoreIcon /></IconButton>
        <IconButton :size="size" label="设置" active><SettingsIcon /></IconButton>
        <IconButton :size="size" label="删除" tone="danger"><DeleteIcon /></IconButton>
        <IconButton :size="size" label="不可用" disabled><DownloadIcon /></IconButton>
      </GalleryRow>
      <GalleryRow label="subtle">
        <IconButton size="lg" variant="subtle" label="添加"><AddIcon /></IconButton>
      </GalleryRow>
      <GalleryRow label="overlay">
        <div class="buttons__media">
          <IconButton variant="overlay" size="md" label="全屏"><FullscreenIcon /></IconButton>
          <IconButton variant="overlay" size="md" label="下载"><DownloadIcon /></IconButton>
          <IconButton variant="overlay" size="md" label="删除"><DeleteIcon /></IconButton>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="ActionButtons" note="对话框、表单底部的主次按钮组：次操作在左、主操作在右。">
      <GalleryRow label="默认"><ActionButtons primary-action-text="保存" secondary-action-text="取消" /></GalleryRow>
      <GalleryRow label="危险"><ActionButtons primary-variant="danger" primary-action-text="删除" secondary-action-text="取消" /></GalleryRow>
      <GalleryRow label="轻强调"><ActionButtons primary-variant="accent" primary-action-text="开始分析" secondary-action-text="稍后" /></GalleryRow>
      <GalleryRow label="胶囊 · ghost 次操作"><ActionButtons shape="pill" secondary-variant="ghost" primary-action-text="确认" secondary-action-text="返回" /></GalleryRow>
      <GalleryRow label="主操作不可用"><ActionButtons is-primary-action-disabled primary-action-text="发送" secondary-action-text="取消" /></GalleryRow>
    </GalleryBlock>
  </div>
</template>

<style>
.buttons__media {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: var(--space-1);
  width: 280px; /* scale-exempt: 版面尺寸 */
  height: 120px; /* scale-exempt: 版面尺寸 */
  padding: var(--space-2);
  border-radius: var(--radius-lg);
  /* 图片覆盖层按钮叠在内容上，示意内容用固定深色渐变，不随主题变化。 */
  background: linear-gradient(
    150deg,
    color-mix(in srgb, var(--color-accent) 45%, var(--color-black)),
    color-mix(in srgb, var(--color-black) 85%, var(--color-white))
  );
}
</style>
