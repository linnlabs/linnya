<script setup lang="ts">
import { ref } from 'vue';
import {
  CustomCheckbox,
  CustomRadio,
  SegmentedTabs,
  Switch,
  TagChip,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { FolderIcon, TagIcon } from '@linnya/renderer-ui/icons';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const autoSave = ref(true);
const webSearch = ref(false);
const sources = ref<Array<string | number | boolean>>(['docs']);
const density = ref('comfortable');
const switchOn = ref(true);
const switchOff = ref(false);
const filter = ref('all');
const view = ref('files');
const tags = ref(['路线图', '季度复盘', '投资人']);

const FILTER_TABS: SegmentedTabItem[] = [
  { id: 'all', label: '全部', count: 24 },
  { id: 'documents', label: '文档', count: 12 },
  { id: 'canvas', label: '画布', count: 3 },
  { id: 'slides', label: '演示稿', count: 9 },
  { id: 'archived', label: '已归档', disabled: true },
];

const VIEW_TABS: SegmentedTabItem[] = [
  { id: 'files', label: '文件' },
  { id: 'conversations', label: '对话' },
  { id: 'knowledge', label: '知识库' },
];

function removeTag(tag: string) {
  tags.value = tags.value.filter(item => item !== tag);
}
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="复选与单选">
      <GalleryRow label="CustomCheckbox">
        <CustomCheckbox v-model="autoSave">自动保存</CustomCheckbox>
        <CustomCheckbox v-model="webSearch">联网搜索</CustomCheckbox>
        <CustomCheckbox :model-value="true" disabled>不可更改</CustomCheckbox>
        <CustomCheckbox :model-value="false" disabled>不可选择</CustomCheckbox>
      </GalleryRow>
      <GalleryRow label="多选与说明" align="start">
        <div class="gallery-stack">
          <CustomCheckbox v-model="sources" value="docs">
            项目文档
            <template #description>回答时引用项目里的文档与画布。</template>
          </CustomCheckbox>
          <CustomCheckbox v-model="sources" value="knowledge">
            知识库
            <template #description>检索已关联的知识库原文。</template>
          </CustomCheckbox>
        </div>
      </GalleryRow>
      <GalleryRow label="CustomRadio">
        <CustomRadio v-model="density" value="comfortable" name="density">宽松</CustomRadio>
        <CustomRadio v-model="density" value="compact" name="density">紧凑</CustomRadio>
        <CustomRadio v-model="density" value="locked" name="density" disabled>不可选择</CustomRadio>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="开关">
      <GalleryRow label="Switch">
        <Switch v-model="switchOn" ariaLabel="开启" />
        <Switch v-model="switchOff" ariaLabel="关闭" />
        <Switch :model-value="true" disabled ariaLabel="开启且禁用" />
        <Switch :model-value="false" disabled ariaLabel="关闭且禁用" />
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="分段页签" note="下划线只有一根，在页签之间滑动。">
      <GalleryRow label="带数量"><SegmentedTabs v-model="filter" :tabs="FILTER_TABS" aria-label="类型筛选" /></GalleryRow>
      <GalleryRow label="普通"><SegmentedTabs v-model="view" :tabs="VIEW_TABS" aria-label="视图" /></GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="标签">
      <GalleryRow label="TagChip">
        <TagChip label="研究" />
        <TagChip label="项目文件夹"><template #icon><FolderIcon /></template></TagChip>
        <TagChip v-for="tag in tags" :key="tag" :label="tag" closable @close="removeTag(tag)">
          <template #icon><TagIcon /></template>
        </TagChip>
      </GalleryRow>
    </GalleryBlock>
  </div>
</template>
