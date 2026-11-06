<template>
  <div class="presentation-card presentation-direction-card">
    <ToolActivityIndicator
      v-if="presentation.status === 'loading'"
      :running-label="slidesToolCardMessage('slides.tool.direction.loading')"
    />
    <div v-else-if="presentation.status === 'error'" class="error-state">
      <span>{{ slidesToolCardMessage('slides.tool.direction.error') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ToolActivityIndicator } from '@plugin/renderer/executionPresentation';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { SlidesDirectionPresentationData } from '../definitions/slidesToolPresentation';
import { useSlidesToolCardLocalization } from '../ui/useSlidesToolCardLocalization';

defineProps<{
  presentation: ToolCardPresentation<SlidesDirectionPresentationData>;
  messageId?: string;
}>();

const { slidesToolCardMessage } = useSlidesToolCardLocalization();
</script>
