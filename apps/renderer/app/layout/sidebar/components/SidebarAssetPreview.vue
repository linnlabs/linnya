<template>
  <ImagePreviewModal
    :is-visible="imagePreview.visible"
    :src="imagePreview.loading || imagePreview.error ? '' : imagePreview.src"
    :alt="imagePreview.name"
    :class-names="imagePreviewClassNames"
    @close="$emit('close-image')"
    @error="$emit('image-error')"
  >
    <template #placeholder>
      <div
        v-if="imagePreview.loading"
        class="sidebar-asset-preview-state"
        @click.stop
      >
        {{ layoutMessage('layout.sidebar.assetPreview.loadingImage') }}
      </div>
      <div
        v-else-if="imagePreview.error"
        class="sidebar-asset-preview-state is-error"
        @click.stop
      >
        {{ imagePreview.error }}
      </div>
    </template>
  </ImagePreviewModal>

  <Teleport to="body">
    <div
      v-if="textPreview.visible"
      class="asset-preview-backdrop"
      @click="$emit('close-text')"
    >
      <div
        class="asset-preview-panel asset-text-preview-panel"
        @click.stop
      >
        <div class="asset-preview-header">
          <span class="asset-preview-title">{{ textPreview.name }}</span>
          <button
            class="asset-preview-close"
            :title="layoutMessage('layout.sidebar.assetPreview.close')"
            @click="$emit('close-text')"
          >
            ×
          </button>
        </div>
        <div class="asset-preview-body asset-text-preview-body">
          <div
            v-if="textPreview.loading"
            class="asset-preview-state"
          >
            {{ layoutMessage('layout.sidebar.assetPreview.loadingText') }}
          </div>
          <div
            v-else-if="textPreview.error"
            class="asset-preview-state is-error"
          >
            {{ textPreview.error }}
          </div>
          <pre
            v-else
            class="asset-text-preview-content"
          >{{ textPreview.text }}</pre>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import type { WorkspaceAssetImagePreviewState } from '@/domains/workspace/features/asset-image-preview';
import { ImagePreviewModal } from '@linnya/renderer-ui';

export interface TextPreviewState {
  visible: boolean;
  loading: boolean;
  name: string;
  text: string;
  error: string;
}

defineProps<{
  imagePreview: WorkspaceAssetImagePreviewState;
  textPreview: TextPreviewState;
}>();

defineEmits<{
  'close-image': [];
  'image-error': [];
  'close-text': [];
}>();

const { layoutMessage } = useLayoutLocalization();
const imagePreviewClassNames = Object.freeze({ overlay: 'sidebar-asset-image-preview' });
</script>
