<script setup lang="ts">
import { ref } from 'vue';
import {
  BaseButton,
  CharacterCount,
  NotificationBar,
  PageSectionHeader,
  ScrollToBottomButton,
  SegmentedTabs,
  Skeleton,
  SkeletonBlock,
  SkeletonRows,
  type NotificationType,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { AddIcon, LinnyaLoadingIcon, LoadingIcon } from '@linnya/renderer-ui/icons';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const NOTIFICATIONS: readonly { type: NotificationType; message: string }[] = [
  { type: 'success', message: '已保存到项目' },
  { type: 'info', message: '正在同步知识库，完成后会自动刷新' },
  { type: 'warning', message: '本月用量即将用完' },
  { type: 'error', message: '导出失败：文件被其他程序占用' },
];

const ACTIVITIES = [
  { activity: 'thinking', label: '等待回复、推理中、处理已有材料' },
  { activity: 'generating', label: '生成新内容' },
] as const;

const SKELETON_LINE_WIDTHS = ['92%', '78%', '85%', '40%'] as const;

const tab = ref('files');
const HEADER_TABS: SegmentedTabItem[] = [
  { id: 'files', label: '文件', count: 18 },
  { id: 'conversations', label: '对话', count: 6 },
];
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="通知条" note="纯展示组件；定位和自动关闭由 Host 负责，这里放进固定高度的容器里静态展示。">
      <div v-for="item in NOTIFICATIONS" :key="item.type" class="gallery-row">
        <div class="gallery-row__label">{{ item.type }}</div>
        <div class="feedback__status-frame">
          <NotificationBar visible :type="item.type" :message="item.message" :right="16" />
        </div>
      </div>
      <GalleryRow label="字数统计">
        <div class="feedback__status-frame">
          <CharacterCount :count="1286" />
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="加载" note="LinnyaLoadingIcon 按正在做的事区分动态；骨架屏按真实布局取形状。">
      <GalleryRow v-for="item in ACTIVITIES" :key="item.activity" :label="`${item.activity} · ${item.label}`">
        <LinnyaLoadingIcon :activity="item.activity" />
        <span class="gallery-caption">Linnya 正在{{ item.label }}</span>
      </GalleryRow>
      <GalleryRow label="通用加载">
        <LoadingIcon class="feedback__loading" />
      </GalleryRow>
      <GalleryRow label="SkeletonRows" align="start">
        <div class="feedback__skeleton">
          <SkeletonRows label="正在加载文件列表" :rows="4" icon trailing :delayed="false" />
        </div>
        <div class="feedback__skeleton">
          <SkeletonRows label="正在加载对话" :rows="3" size="lg" icon :delayed="false" />
        </div>
      </GalleryRow>
      <GalleryRow label="Skeleton 组合" align="start">
        <div class="feedback__skeleton">
          <Skeleton label="正在加载详情" :delayed="false">
            <SkeletonBlock width="20px" height="20px" radius="sm" />
            <SkeletonBlock v-for="width in SKELETON_LINE_WIDTHS" :key="width" :width="width" />
          </Skeleton>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="分区标题">
      <div class="feedback__header-frame">
        <PageSectionHeader title="默认项目" subtitle="2 份文件 · 1 个文件夹 · 10 字" :heading-level="2">
          <template #actions>
            <BaseButton variant="outline" tone="accent" size="md" shape="pill"><template #icon><AddIcon /></template>新建文档</BaseButton>
          </template>
          <template #tabs>
            <SegmentedTabs v-model="tab" :tabs="HEADER_TABS" aria-label="项目内容" />
          </template>
        </PageSectionHeader>
      </div>
      <div class="feedback__header-frame">
        <PageSectionHeader title="存储空间" meta="上次清理：3 天前" title-size="compact" :heading-level="2" />
      </div>
    </GalleryBlock>

    <GalleryBlock title="回到底部">
      <div class="feedback__scroll-frame">
        <ScrollToBottomButton show />
      </div>
    </GalleryBlock>
  </div>
</template>

<style>
/* transform 让 fixed / absolute 定位的组件以这个框为参照，静态摆放。 */
.feedback__status-frame {
  position: relative;
  transform: translateZ(0);
  width: 420px; /* scale-exempt: 版面尺寸 */
  height: 48px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-md);
  background-color: var(--color-bg-subtle);
}

.feedback__loading {
  width: 18px;
  height: 18px;
  color: var(--color-text-tertiary);
}

.feedback__skeleton {
  width: 320px; /* scale-exempt: 版面尺寸 */
}

.feedback__header-frame {
  max-width: 760px; /* scale-exempt: 版面尺寸 */
}

.feedback__scroll-frame {
  position: relative;
  width: 420px; /* scale-exempt: 版面尺寸 */
  height: 96px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-md);
  background-color: var(--color-bg-subtle);
}
</style>
