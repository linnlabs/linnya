<template>
  <!--
    Agent 查看图片不套卡片：一行“查看了…”。对话里已经直接显示过的图（下载的、生成的）不重复显示；
    其余（工作区里的、自己裁的）在下面放小图，比下载的图小一半。
  -->
  <div class="image-read-card">
    <ToolInlineLine
      :icon="EyeIcon"
      :icon-props="{ visible: true }"
      :loading="presentation.status === 'loading'"
      :text="lineText"
    />
    <ConversationImageAttachmentGallery
      v-if="showThumbnails && attachments"
      class="image-read-card__thumbnails"
      :attachments="attachments"
      display-mode="compact-result"
    />
    <p
      v-else-if="showUnavailable"
      class="image-read-card__unavailable"
    >
      {{ conversationMessage('conversation.tool.imageRead.unavailable') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { EyeIcon } from '@linnya/renderer-ui/icons';
import type {
  ToolCardPresentation,
  ToolUiImageAttachmentRef,
} from '../types';
import ConversationImageAttachmentGallery from '../../../features/image-attachments/ui/ConversationImageAttachmentGallery.vue';
import { useConversationLocalization } from '../../useConversationLocalization';
import ToolInlineLine from '../shared/ToolInlineLine.vue';
import type { ImageReadPresentationData } from './definitions/imageReadPresentation';

const props = defineProps<{
  readonly presentation: ToolCardPresentation<ImageReadPresentationData>;
  readonly attachments?: readonly ToolUiImageAttachmentRef[];
}>();

const { conversationMessage } = useConversationLocalization();

const image = computed(() => (props.presentation.data.kind === 'image' ? props.presentation.data : undefined));

const lineText = computed(() => {
  if (props.presentation.status === 'loading') return conversationMessage('conversation.tool.imageRead.title');
  if (image.value?.alreadyShown) return conversationMessage('conversation.tool.imageRead.viewedShown');
  return image.value?.fileName
    ? conversationMessage('conversation.tool.imageRead.viewedNamed', { name: image.value.fileName })
    : conversationMessage('conversation.tool.imageRead.viewed');
});

const showThumbnails = computed(() => !image.value?.alreadyShown && (props.attachments?.length ?? 0) > 0);
const showUnavailable = computed(() => (
  props.presentation.status === 'success' && !image.value?.alreadyShown && (props.attachments?.length ?? 0) === 0
));
</script>
