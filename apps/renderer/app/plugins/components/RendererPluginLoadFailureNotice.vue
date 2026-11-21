<template>
  <Transition name="renderer-plugin-load-notice-fade">
    <div
      v-if="notice.visible.value"
      class="renderer-plugin-load-notice"
      role="alert"
      data-testid="renderer-plugin-load-failure-notice"
    >
      <span class="renderer-plugin-load-notice__message">{{ notice.message.value }}</span>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="notice.retrying.value"
        data-testid="renderer-plugin-load-failure-retry"
        @click="notice.retry()"
      >
        {{ notice.pluginLoadMessage(notice.retrying.value ? 'plugins.runtimeLoad.action.retrying' : 'plugins.runtimeLoad.action.retry') }}
      </BaseButton>
      <IconButton
        size="sm"
        :label="notice.pluginLoadMessage('plugins.runtimeLoad.action.dismiss')"
        class="renderer-plugin-load-notice__dismiss"
        @click="notice.dismiss()"
      >
        <CloseIcon />
      </IconButton>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { BaseButton, IconButton } from '@linnya/renderer-ui';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { useRendererPluginLoadFailureNotice } from '../ui/useRendererPluginLoadFailureNotice';

const props = defineProps<{
  readonly retry: () => Promise<void>;
}>();

const notice = useRendererPluginLoadFailureNotice(() => props.retry());
</script>
