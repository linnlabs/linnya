<!--
  apps/renderer/domains/settings/ui/kit/SettingsSection.vue

  设置分区。相邻分区之间自动出现分隔线，业务层不需要再手工加
  .section-divider-bottom 这类容器类。
-->
<template>
  <section class="settings-section">
    <header
      v-if="title || description || $slots.actions"
      class="settings-section-header"
    >
      <div class="settings-section-heading-area">
        <h3
          v-if="title"
          class="settings-section-heading"
        >
          {{ title }}
        </h3>
        <p
          v-if="description"
          class="settings-section-description"
        >
          {{ description }}
        </p>
      </div>
      <div
        v-if="$slots.actions"
        class="settings-section-actions"
      >
        <slot name="actions" />
      </div>
    </header>

    <div class="settings-section-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  /** 分区说明，放在分区标题下方、第一行控件之前。 */
  description?: string;
}>();
</script>
