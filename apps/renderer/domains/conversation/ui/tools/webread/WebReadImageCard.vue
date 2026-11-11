<template>
  <!-- 下载的图片和生成的图片一样直接显示，不套卡片；下面一行写来源、尺寸与许可。 -->
  <div class="web-read-image">
    <ImageRenderer
      v-if="presentation.status === 'loading'"
      :images="[]"
      status="loading"
      :loading-label="conversationMessage('conversation.tool.webReadImage.loading')"
    />
    <template v-else-if="data.kind === 'image'">
      <ImageRenderer
        v-if="data.media"
        :images="[data.media]"
        status="success"
      />
      <ToolInlineLine
        v-else
        :icon="ImageIcon"
        :text="conversationMessage('conversation.tool.webReadImage.downloaded')"
      />
      <div class="web-read-image__source">
        <button
          type="button"
          class="web-read-image__host"
          :data-linnya-tooltip="conversationMessage('conversation.tool.webReadImage.openSource')"
          @click="openExternalUrl(data.sourceUrl)"
        >
          {{ data.sourceHost }}
          <ExternalLinkIcon class="web-read-image__host-icon" />
        </button>
        <span class="web-read-image__dot">·</span>
        <span>{{ data.width }} × {{ data.height }}</span>
        <template v-if="data.license">
          <span class="web-read-image__dot">·</span>
          <span class="web-read-image__license">{{ data.license.name }}</span>
          <span
            v-if="licenseTerms"
            class="web-read-image__terms"
          >{{ licenseTerms }}</span>
        </template>
        <template
          v-for="note in notes"
          :key="note"
        >
          <span class="web-read-image__dot">·</span>
          <span class="web-read-image__note">{{ note }}</span>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ExternalLinkIcon, ImageIcon } from '@linnya/renderer-ui/icons';
import { openExternalUrl } from '../../../../../shared/utils/openExternalUrl';
import { useConversationLocalization } from '../../useConversationLocalization';
import ImageRenderer from '../image/ImageRenderer.vue';
import ToolInlineLine from '../shared/ToolInlineLine.vue';
import type { ToolCardPresentation } from '../types';
import type { WebReadImagePresentationData } from './definitions/webReadImagePresentation';

const props = defineProps<{
  readonly presentation: ToolCardPresentation<WebReadImagePresentationData>;
}>();

const { conversationMessage } = useConversationLocalization();
const data = computed(() => props.presentation.data);

/** 许可的几条要点：能否商用、要不要署名、相同方式共享、能否改动；非 CC 条款只提示看来源页。 */
const licenseTerms = computed(() => {
  const value = data.value;
  if (value.kind !== 'image' || !value.license) return undefined;
  const license = value.license;
  if (license.code === 'other') return conversationMessage('conversation.tool.webReadImage.otherTerms');
  return [
    conversationMessage(license.commercialUse
      ? 'conversation.tool.webReadImage.commercial'
      : 'conversation.tool.webReadImage.nonCommercial'),
    ...(license.attributionRequired ? [conversationMessage('conversation.tool.webReadImage.attribution')] : []),
    ...(license.code.includes('sa') ? [conversationMessage('conversation.tool.webReadImage.shareAlike')] : []),
    ...(!license.modifications ? [conversationMessage('conversation.tool.webReadImage.noDerivatives')] : []),
  ].join(conversationMessage('conversation.tool.webReadImage.termsSeparator'));
});

/** 没有许可记录时，给出网页上的署名或版权声明原文；都没有就提示引用前看来源网页。 */
const notes = computed(() => {
  const value = data.value;
  if (value.kind !== 'image' || value.license) return [];
  const items = [
    ...(value.credit ? [conversationMessage('conversation.tool.webReadImage.credit', { credit: value.credit })] : []),
    ...(value.pageRights ? [conversationMessage('conversation.tool.webReadImage.pageRights', { text: value.pageRights })] : []),
  ];
  return items.length > 0 ? items : [conversationMessage('conversation.tool.webReadImage.noLicense')];
});
</script>
