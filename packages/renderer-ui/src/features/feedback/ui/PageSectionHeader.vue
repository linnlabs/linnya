<!-- packages/renderer-ui/src/features/feedback/ui/PageSectionHeader.vue -->
<template>
  <header
    class="page-section-header"
    :class="{
      'is-title-compact': titleSize === 'compact',
      'has-tabs': hasTabsSlot,
    }"
  >
    <div class="page-section-header__main">
      <div class="page-section-header__left">
        <div class="page-section-header__title-block">
          <div class="page-section-header__title-row">
            <component :is="headingTag" class="page-section-header__title">
              {{ title }}
            </component>
            <slot name="title-after" />
          </div>
          <p v-if="subtitle" class="page-section-header__subtitle">
            {{ subtitle }}
          </p>
        </div>

        <p v-if="meta" class="page-section-header__meta">
          {{ meta }}
        </p>
      </div>

      <div v-if="hasActionsSlot" class="page-section-header__actions">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="hasTabsSlot" class="page-section-header__tabs">
      <slot name="tabs" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue';

const props = withDefaults(defineProps<{
  title: string;
  subtitle?: string;
  meta?: string;
  headingLevel?: 1 | 2;
  titleSize?: 'default' | 'compact';
}>(), {
  subtitle: undefined,
  meta: undefined,
  headingLevel: 1,
  titleSize: 'default',
});

const slots = useSlots();

const hasActionsSlot = computed(() => Boolean(slots.actions));
const hasTabsSlot = computed(() => Boolean(slots.tabs));
const headingTag = computed(() => `h${props.headingLevel}`);
</script>
