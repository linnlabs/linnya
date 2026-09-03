<template>
  <div class="image-renderer">
    <!--
      加载状态:
      - 当 status 为 'loading' 时显示美观的占位符
    -->
    <div v-if="status === 'loading'" class="image-placeholder">
      <div class="placeholder-content">
        <div class="loading-spinner"></div>
        <div class="loading-title">{{ conversationMessage('conversation.tool.image.loading') }}</div>
      </div>
    </div>

    <!--
      成功状态 - 单张图片:
      - 当 status 为 'success' 且是单张图片时显示
    -->
    <div
      v-else-if="status === 'success' && singleImageEntry"
      class="image-container single-item"
      :class="{ 'has-aspect-ratio': singleImageEntry.dimensions !== undefined }"
      :style="singleImageStyle"
    >
      <img
        :src="singleImageEntry.url"
        :alt="conversationMessage('conversation.tool.image.alt')"
        class="generated-image"
        decoding="async"
        @load="onImageLoad"
        @error="onImageError"
      />

      <!-- 控件卡片 -->
      <div class="image-controls">
        <button
          class="control-button"
          :class="{ 'copied': copiedImageUrl === singleImageEntry.url }"
          :title="copiedImageUrl === singleImageEntry.url ? conversationMessage('conversation.tool.image.copied') : conversationMessage('conversation.tool.image.copy')"
          @click="copyImage(singleImageEntry.url)"
        >
          <CopyIcon v-if="copiedImageUrl !== singleImageEntry.url" />
          <span v-else class="copied-text">{{ conversationMessage('conversation.tool.image.copied') }}</span>
        </button>
        <button class="control-button" :title="conversationMessage('conversation.tool.image.preview')" @click="openPreviewModal(singleImageEntry.url)">
          <ZoomInIcon />
        </button>
        <button class="control-button" :title="conversationMessage('conversation.tool.image.download')" @click="downloadImage(singleImageEntry.url, singleImageEntry.fileName)">
          <DownloadIcon />
        </button>
      </div>
    </div>

    <!--
      成功状态 - 多张图片:
      - 当 status 为 'success' 且是多张图片时显示
    -->
    <div v-else-if="status === 'success' && multipleImageEntries.length > 0" class="image-grid">
      <div
        v-for="(imageEntry, index) in multipleImageEntries"
        :key="imageEntry.url"
        class="image-container grid-item"
      >
        <img
          :src="imageEntry.url"
          :alt="conversationMessage('conversation.tool.image.altIndexed', { index: index + 1 })"
          class="generated-image grid-image"
          decoding="async"
          @load="onImageLoad"
          @error="onImageError"
        />

        <!-- 控件卡片 -->
        <div class="image-controls">
          <button
            class="control-button"
            :class="{ 'copied': copiedImageUrl === imageEntry.url }"
            :title="copiedImageUrl === imageEntry.url ? conversationMessage('conversation.tool.image.copied') : conversationMessage('conversation.tool.image.copy')"
            @click="copyImage(imageEntry.url)"
          >
            <CopyIcon v-if="copiedImageUrl !== imageEntry.url" />
            <span v-else class="copied-text">{{ conversationMessage('conversation.tool.image.copied') }}</span>
          </button>
          <button class="control-button" :title="conversationMessage('conversation.tool.image.preview')" @click="openPreviewModal(imageEntry.url)">
            <ZoomInIcon />
          </button>
          <button class="control-button" :title="conversationMessage('conversation.tool.image.download')" @click="downloadImage(imageEntry.url, imageEntry.fileName)">
            <DownloadIcon />
          </button>
        </div>
      </div>
    </div>

    <!--
      失败/错误状态:
      - 当 status 为 'error' 时显示友好的错误信息
    -->
    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-icon">❌</div>
      <div class="error-content">
        <h4>{{ conversationMessage('conversation.tool.image.failed') }}</h4>
        <p>{{ conversationMessage('conversation.tool.image.retryLater') }}</p>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-text">{{ conversationMessage('conversation.tool.image.empty') }}</div>
    </div>

    <ImagePreviewModal
      :is-visible="isPreviewModalOpen"
      :src="previewImageUrl"
      :alt="conversationMessage('conversation.tool.image.preview')"
      @close="closePreviewModal"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from 'vue';
import { ImagePreviewModal } from '@linnya/renderer-ui';
import type { ImageGenerationPresentationImage } from './definitions/imageGenerationPresentation';
import { ZoomInIcon } from '@linnya/renderer-ui/icons';
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { DownloadIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../useConversationLocalization';
import {
  publishConversationPerf,
  readConversationPerfNowMs,
} from '../../../shared/observability/conversationPerf';
import {
  calculateConversationImageBoxSize,
  calculateConversationImageReservedBoxSize,
  CONVERSATION_IMAGE_MAX_WIDTH_PX,
} from '../../../functions/conversationImageLayout';

const props = defineProps<{
  images: readonly ImageGenerationPresentationImage[];
  status: 'loading' | 'success' | 'error';
}>();

const { conversationMessage } = useConversationLocalization();

interface ImageEntry {
  url: string;
  fileName: string;
  dimensions?: {
    readonly width: number;
    readonly height: number;
  };
}

// 全屏预览相关状态
const isPreviewModalOpen = ref(false);
const previewImageUrl = ref<string>('');

// 复制状态跟踪
const copiedImageUrl = ref<string | null>(null);
let copiedFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
const mediaImageEntryCache = new Map<string, Pick<ImageEntry, 'url' | 'fileName'>>();

const showCopiedFeedback = (imageUrl: string): void => {
  copiedImageUrl.value = imageUrl;
  if (copiedFeedbackTimer) clearTimeout(copiedFeedbackTimer);
  copiedFeedbackTimer = setTimeout(() => {
    copiedImageUrl.value = null;
    copiedFeedbackTimer = null;
  }, 2000);
};

// 检查路径是否为本地文件路径
const isLocalPath = (path: string): boolean => {
  if (!path) return false;
  return !path.startsWith('http://')
    && !path.startsWith('https://')
    && !path.startsWith('data:')
    && !path.startsWith('media://');
};

const resolveImageFileName = (imagePath: string, fallback: string): string => {
  const fileName = window.linnyaMedia.getFileName(imagePath);
  return fileName.length > 0 ? fileName : fallback;
};

const buildImageEntry = (
  image: ImageGenerationPresentationImage,
  fallbackFileName: string,
): ImageEntry => {
  const trimmedPath = image.path.trim();
  const dimensions = image.width !== undefined && image.height !== undefined
    ? { width: image.width, height: image.height }
    : undefined;
  if (isLocalPath(trimmedPath)) {
    const cached = mediaImageEntryCache.get(trimmedPath);
    if (cached) {
      return { ...cached, dimensions };
    }

    const startedAt = readConversationPerfNowMs();
    const url = window.linnyaMedia.buildGeneratedImageUrl(trimmedPath);
    publishConversationPerf({
      kind: 'image-load',
      phase: 'media-url-build',
      durationMs: readConversationPerfNowMs() - startedAt,
      details: {
        imagePath: trimmedPath,
      },
    });

    const entry = {
      url,
      fileName: resolveImageFileName(trimmedPath, fallbackFileName),
    };
    mediaImageEntryCache.set(trimmedPath, entry);
    return { ...entry, dimensions };
  }

  return {
    url: trimmedPath,
    fileName: resolveImageFileName(trimmedPath, fallbackFileName),
    dimensions,
  };
};

const singleImageEntry = computed<ImageEntry | null>(() => {
  const image = props.images.length === 1 ? props.images[0] : undefined;
  return image ? buildImageEntry(image, 'ai-generated-image.png') : null;
});

const singleImageStyle = computed<Record<string, string> | undefined>(() => {
  if (!singleImageEntry.value) return undefined;
  const dimensions = singleImageEntry.value?.dimensions;
  const metadataBoxSize = calculateConversationImageBoxSize(
    dimensions,
    CONVERSATION_IMAGE_MAX_WIDTH_PX,
  );
  const boxSize = calculateConversationImageReservedBoxSize(
    dimensions,
    CONVERSATION_IMAGE_MAX_WIDTH_PX,
  );
  if (!metadataBoxSize || !dimensions) {
    return {
      width: `${boxSize.widthPx}px`,
      height: `${boxSize.heightPx}px`,
    };
  }
  return {
    width: `${boxSize.widthPx}px`,
    'aspect-ratio': `${dimensions.width} / ${dimensions.height}`,
  };
});

const multipleImageEntries = computed<ImageEntry[]>(() => {
  if (props.images.length <= 1) return [];
  return props.images.map((image, index) => (
    buildImageEntry(image, `ai-generated-image-${index + 1}.png`)
  ));
});

// 图片加载完成
const onImageLoad = (event: Event) => {
  const img = event.target as HTMLImageElement;
  img.classList.add('loaded');
  publishConversationPerf({
    kind: 'image-load',
    phase: 'img-load',
    details: {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    },
  });
};

// 图片加载失败
const onImageError = (event: Event) => {
  const img = event.target as HTMLImageElement;
  img.classList.add('error');
  console.error('图片加载失败:', img.src);
};

// 全屏预览图片
const openPreviewModal = (imageUrl: string) => {
  previewImageUrl.value = imageUrl;
  isPreviewModalOpen.value = true;
};

const closePreviewModal = () => {
  isPreviewModalOpen.value = false;
  previewImageUrl.value = '';
};

// 复制图片到剪贴板
const copyImage = async (imageUrl: string) => {
  try {
    // 如果是 data URL，直接处理
    if (imageUrl.startsWith('data:image/')) {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      console.log('图片已复制到剪贴板');

      // 设置复制成功状态
      showCopiedFeedback(imageUrl);

      return;
    }

    // 对于其他 URL，先转换为 blob
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    console.log('图片已复制到剪贴板');

    // 设置复制成功状态
    showCopiedFeedback(imageUrl);
  } catch (error) {
    console.error('复制图片失败:', error);
    // 如果复制失败，尝试复制图片 URL
    try {
      await navigator.clipboard.writeText(imageUrl);
      console.log('图片链接已复制到剪贴板');

      // 即使是复制链接，也显示已复制状态
      showCopiedFeedback(imageUrl);
    } catch (urlError) {
      console.error('复制图片链接也失败:', urlError);
    }
  }
};

// 下载图片
const downloadImage = async (imageUrl: string, fileName: string) => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`download failed: ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    console.error('下载图片失败:', error);
  }
};

onBeforeUnmount(() => {
  if (copiedFeedbackTimer) clearTimeout(copiedFeedbackTimer);
});
</script>
