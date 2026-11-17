<script setup lang="ts">
import { ref } from 'vue';
import {
  ActionButtons,
  AlertDialog,
  BaseButton,
  CustomSelect,
  CustomTextInput,
  ImagePreviewModal,
  Modal,
  useImagePreviewSource,
  type AlertDialogSection,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import type { GalleryOverlayId } from '../definitions/gallerySections.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const props = defineProps<{
  /** 由 URL 的 open 参数直接打开，方便截图。 */
  readonly openOverlay: GalleryOverlayId | null;
}>();

const open = ref<GalleryOverlayId | null>(props.openOverlay);
const projectName = ref('季度复盘');
const template = ref('blank');
const { sourceElement, rememberSource } = useImagePreviewSource();

const TEMPLATE_OPTIONS: CustomSelectOption<string>[] = [
  { text: '空白项目', value: 'blank' },
  { text: '研究报告', value: 'research' },
  { text: '会议纪要', value: 'meeting' },
];

const DELETE_SECTIONS: readonly AlertDialogSection[] = [
  { title: '将被删除', items: ['12 份文档', '3 个画布', '6 段对话'] },
];

/** 示意图片：固定配色的内容图，不随主题变化。 */
const PREVIEW_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe9e2"/><stop offset="1" stop-color="#f6f3ea"/></linearGradient></defs>
    <rect width="960" height="600" fill="url(#sky)"/>
    <path d="M0 420 L180 260 L320 380 L480 220 L660 400 L800 300 L960 420 L960 600 L0 600 Z" fill="#8fae97"/>
    <path d="M0 480 L240 360 L420 470 L620 350 L960 500 L960 600 L0 600 Z" fill="#5f7f68"/>
    <circle cx="760" cy="140" r="56" fill="#f2d6a2"/>
  </svg>`
)}`;

function close() {
  open.value = null;
}
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="对话框" note="遮罩只淡底色，弹窗本体缩放 3% 缓出；正文滚动时标题与操作区之间不加分隔线。">
      <GalleryRow label="打开">
        <BaseButton variant="secondary" size="md" @click="open = 'dialog'">表单对话框</BaseButton>
        <BaseButton variant="secondary" size="md" @click="open = 'confirm'">确认框</BaseButton>
        <BaseButton variant="secondary" size="md" @click="open = 'danger-confirm'">危险确认</BaseButton>
        <button type="button" class="dialogs__thumb" aria-label="预览图片" @click="event => { rememberSource(event); open = 'image-preview'; }">
          <img :src="PREVIEW_IMAGE" alt="" />
        </button>
      </GalleryRow>
      <p class="gallery-caption">截图时可在地址后加 ?section=dialogs&amp;open=dialog（或 confirm、danger-confirm、image-preview）直接打开。</p>
    </GalleryBlock>

    <Modal :is-visible="open === 'dialog'" title="新建项目" width="440px" :close-on-overlay-click="false" @close="close">
      <div class="dialogs__form">
        <label class="dialogs__field">
          <span>项目名称</span>
          <CustomTextInput v-model="projectName" placeholder="输入项目名称" />
        </label>
        <label class="dialogs__field">
          <span>模板</span>
          <CustomSelect v-model="template" :options="TEMPLATE_OPTIONS" trigger-aria-label="模板" />
        </label>
        <p class="dialogs__hint">项目创建后可以随时改名，文档不会丢失。</p>
      </div>
      <template #footer>
        <div class="dialogs__footer">
          <ActionButtons primary-action-text="创建项目" secondary-action-text="取消" @primary-click="close" @secondary-click="close" />
        </div>
      </template>
    </Modal>

    <AlertDialog
      :visible="open === 'confirm'"
      is-confirmation
      title="切换模型"
      message="切换后，这段对话后续的回复会使用新模型，已有的回复不受影响。"
      confirm-text="切换"
      cancel-text="取消"
      @close="close"
      @confirm="close"
      @cancel="close"
    />

    <AlertDialog
      :visible="open === 'danger-confirm'"
      is-confirmation
      is-dangerous-action
      title="删除项目“季度复盘”"
      :sections="DELETE_SECTIONS"
      risk-message="删除后无法恢复。"
      confirm-text="删除项目"
      cancel-text="取消"
      @close="close"
      @confirm="close"
      @cancel="close"
    />

    <ImagePreviewModal
      :is-visible="open === 'image-preview'"
      :src="PREVIEW_IMAGE"
      alt="示意图片"
      :source-element="sourceElement"
      @close="close"
    />
  </div>
</template>

<style>
.dialogs__thumb {
  width: 96px; /* scale-exempt: 版面尺寸 */
  height: 60px; /* scale-exempt: 版面尺寸 */
  overflow: hidden;
  border-radius: var(--radius-md);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
}

.dialogs__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 正文与底部的内边距由调用方提供，取值与“新建项目”弹窗、AlertDialog 一致。 */
.dialogs__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-8) 0;
}

.dialogs__footer {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-6) var(--space-8);
}

.dialogs__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}

.dialogs__hint {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}
</style>
