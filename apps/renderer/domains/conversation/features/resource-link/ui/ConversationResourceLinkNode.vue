<template>
  <a
    class="conversation-resource-link"
    :class="[`conversation-resource-link--${stateKind}`, { 'is-disabled': !isReady }]"
    :href="isReady ? canonicalLocator : undefined"
    :aria-disabled="isReady ? undefined : 'true'"
    :title="tooltip"
    @click.prevent="openTarget"
  >
    <component :is="iconComponent" class="conversation-resource-link__icon" :class="iconClass" />
    <span class="conversation-resource-link__title">{{ displayTitle }}</span>
    <span v-if="displaySuffix" class="conversation-resource-link__suffix">{{ displaySuffix }}</span>
    <span v-if="statusText" class="conversation-resource-link__status">{{ statusText }}</span>
  </a>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, shallowRef } from 'vue';
import type { Component } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useNotificationStore } from '@/app/notification';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import {
  getConversationResourceLinkPort,
  type ConversationResourceLinkTarget,
} from '../index';
import { normalizeMarkdownFileLocatorHref } from '../functions/normalizeMarkdownFileLocatorHref';
import { projectPhysicalResourceLinkPresentation } from '../functions/projectConversationResourceLinkPresentation';

const props = defineProps<{
  readonly href: string;
  readonly authoredTitle: string;
}>();

const renderScope = inject(CONVERSATION_RENDER_SCOPE_KEY);
if (!renderScope) {
  throw new Error('ConversationRenderScope 未装配：文件链接必须由 ConversationView 渲染');
}
const ownerScope = renderScope;

const notificationStore = useNotificationStore();
const { conversationMessage } = useConversationLocalization();
const port = getConversationResourceLinkPort();
const normalized = normalizeMarkdownFileLocatorHref(props.href);
const target = shallowRef<ConversationResourceLinkTarget | null>(null);
const resolutionFailed = shallowRef(false);
let disposed = false;

if (normalized.ok) {
  void port.resolve({
    conversation_id: ownerScope.conversationId,
    locator: normalized.parsed.locator,
  }).then((resolved) => {
    if (!disposed) target.value = resolved;
  }).catch((error: unknown) => {
    if (disposed) return;
    resolutionFailed.value = true;
    console.warn('[ConversationResourceLink] 文件链接解析失败', {
      locator: normalized.parsed.locator,
      error,
    });
  });
}

onBeforeUnmount(() => {
  disposed = true;
});

const physicalPresentation = computed(() => {
  if (!normalized.ok || normalized.parsed.kind === 'workspace') return null;
  return projectPhysicalResourceLinkPresentation({
    authoredTitle: props.authoredTitle,
    parsed: normalized.parsed,
  });
});

const isReady = computed(() => target.value?.state === 'ready');
const stateKind = computed(() => {
  if (!normalized.ok) return 'invalid';
  if (resolutionFailed.value) return 'unavailable';
  return target.value?.state ?? 'resolving';
});
const canonicalLocator = computed(() => normalized.ok ? normalized.parsed.locator : '');
const displayTitle = computed(() => {
  const resolved = target.value;
  if (resolved?.state === 'ready' && resolved.kind === 'workspace') return resolved.title;
  return physicalPresentation.value?.title
    || props.authoredTitle.trim()
    || conversationMessage('conversation.resourceLink.genericTitle');
});
const displaySuffix = computed(() => physicalPresentation.value?.suffix ?? null);
const iconComponent = computed<Component>(() => {
  const resolved = target.value;
  return resolved?.state === 'ready' && resolved.kind === 'workspace'
    ? resolved.iconComponent
    : DocumentIcon;
});
const iconClass = computed(() => {
  const resolved = target.value;
  return resolved?.state === 'ready' && resolved.kind === 'workspace'
    ? resolved.iconClass
    : 'file-icon';
});
const statusText = computed(() => {
  if (!normalized.ok) return conversationMessage('conversation.resourceLink.status.invalid');
  if (resolutionFailed.value) return conversationMessage('conversation.resourceLink.status.unavailable');
  if (!target.value) return conversationMessage('conversation.resourceLink.status.resolving');
  if (target.value.state === 'missing') return conversationMessage('conversation.resourceLink.status.missing');
  if (target.value.state === 'unavailable') {
    return conversationMessage('conversation.resourceLink.status.unavailable');
  }
  return '';
});
const tooltip = computed(() => {
  if (!normalized.ok) return conversationMessage('conversation.resourceLink.status.invalid');
  if (target.value?.state === 'missing') {
    return conversationMessage('conversation.resourceLink.tooltip.missing', {
      locator: canonicalLocator.value,
    });
  }
  if (target.value?.state === 'unavailable' || resolutionFailed.value) {
    return conversationMessage('conversation.resourceLink.tooltip.unavailable', {
      locator: canonicalLocator.value,
    });
  }
  return canonicalLocator.value;
});

async function openTarget(): Promise<void> {
  const resolved = target.value;
  if (!resolved || resolved.state !== 'ready') return;
  try {
    await port.open({ conversationId: ownerScope.conversationId, target: resolved });
  } catch (error: unknown) {
    console.warn('[ConversationResourceLink] 打开文件链接失败', {
      locator: resolved.locator,
      error,
    });
    notificationStore.show(
      conversationMessage('conversation.resourceLink.openFailed'),
      'error',
      3000,
    );
  }
}
</script>
