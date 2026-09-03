<template>
  <div class="document-surface" :class="`document-surface--${activeDocument?.type ?? 'none'}`">
    <component :is="activeSurfaceComponent" v-if="activeSurfaceComponent" />
    <UnavailableDocumentPlaceholder
      v-else-if="unavailableDocument"
      :title="unavailableDocument.title"
      :message="unavailableDocument.message"
    />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { computed, nextTick, onBeforeUnmount, watch } from 'vue';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useDocumentTypeAvailabilityByActiveType } from '@/app/plugins/composables';
import { resolveDocumentTypeTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import { useLocalization } from '@/app/localization';
import UnavailableDocumentPlaceholder from '@/app/plugins/components/UnavailableDocumentPlaceholder.vue';
import { getDocumentSurfaceRuntimePort } from '@/shared/ports/documentSurfaceRuntimePort';

const layoutStore = useLayoutStore();
const { layoutMessage } = useLayoutLocalization();
const { t } = useLocalization();
const activeDocument = computed(() => layoutStore.state.activeDocument);
const activeDocumentAvailability = useDocumentTypeAvailabilityByActiveType(
  computed(() => activeDocument.value?.type),
);
const activeSurfaceComponent = computed<Component | null>(() => {
  const availability = activeDocumentAvailability.value;
  return availability?.state === 'enabled' ? availability.documentType.surfaceComponent : null;
});
const unavailableDocument = computed<{ title: string; message: string } | null>(() => {
  const availability = activeDocumentAvailability.value;
  if (!availability || availability.state === 'enabled') return null;

  if (availability.state === 'disabled') {
    const documentTypeText = resolveDocumentTypeTextPresentation(availability.documentType, t);
    return {
      title: layoutMessage('layout.documentSurface.disabledTitle', {
        documentType: documentTypeText.label,
      }),
      message: layoutMessage('layout.documentSurface.disabledMessage'),
    };
  }

  return {
    title: layoutMessage('layout.documentSurface.missingTitle'),
    message: layoutMessage('layout.documentSurface.missingMessage', {
      documentType: availability.activeDocumentType,
    }),
  };
});
const documentSurfaceRuntime = getDocumentSurfaceRuntimePort();

watch(
  activeDocument,
  async (document, previousDocument) => {
    if (previousDocument) {
      documentSurfaceRuntime.clearSurfaceReady(previousDocument);
    }
    if (!document) return;

    await nextTick();
    if (activeDocument.value?.id !== document.id || activeDocument.value.type !== document.type) {
      return;
    }
    documentSurfaceRuntime.markSurfaceReady(document);
  },
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(() => {
  if (activeDocument.value) {
    documentSurfaceRuntime.clearSurfaceReady(activeDocument.value);
  }
});
</script>
