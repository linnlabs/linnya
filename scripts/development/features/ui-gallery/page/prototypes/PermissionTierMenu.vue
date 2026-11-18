<script setup lang="ts">
import { CheckmarkIcon } from '@linnya/renderer-ui/icons';
import {
  PERMISSION_TIERS,
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  type ConversationTierSetting,
  type PermissionTier,
} from './permissionTier.ts';

/** 档位菜单内容：输入框的档位切换与定时任务表单共用。定位与开关由调用方负责。 */
const props = withDefaults(
  defineProps<{
    readonly modelValue: ConversationTierSetting;
    readonly globalTier: PermissionTier;
    readonly allowFollowGlobal?: boolean;
    readonly hint?: string;
    readonly showSettingsLink?: boolean;
  }>(),
  { allowFollowGlobal: true, hint: '', showSettingsLink: true },
);

const emit = defineEmits<{
  select: [value: ConversationTierSetting];
  openSettings: [];
}>();

function choose(value: ConversationTierSetting) {
  if (value !== props.modelValue) emit('select', value);
}
</script>

<template>
  <div class="tier-menu" role="menu" aria-label="权限档位">
    <p v-if="hint" class="tier-menu__hint">{{ hint }}</p>
    <button
      v-if="allowFollowGlobal"
      type="button"
      class="tier-menu__option"
      role="menuitemradio"
      :aria-checked="modelValue === 'global'"
      @click="choose('global')"
    >
      <span class="tier-menu__text">
        <span class="tier-menu__label">跟随全局设置</span>
        <span class="tier-menu__description">现在是“{{ TIER_LABELS[globalTier] }}”。全局设置改了，这里跟着变。</span>
      </span>
      <CheckmarkIcon v-if="modelValue === 'global'" class="tier-menu__check" />
    </button>
    <div v-if="allowFollowGlobal" class="tier-menu__divider" />
    <button
      v-for="tier in PERMISSION_TIERS"
      :key="tier"
      type="button"
      class="tier-menu__option"
      :class="{ 'is-full-access': tier === 'full_access' }"
      role="menuitemradio"
      :aria-checked="modelValue === tier"
      @click="choose(tier)"
    >
      <span class="tier-menu__text">
        <span class="tier-menu__label">{{ TIER_LABELS[tier] }}</span>
        <span class="tier-menu__description">{{ TIER_DESCRIPTIONS[tier] }}</span>
      </span>
      <CheckmarkIcon v-if="modelValue === tier" class="tier-menu__check" />
    </button>
    <template v-if="showSettingsLink">
      <div class="tier-menu__divider" />
      <button type="button" class="tier-menu__option tier-menu__option--link" @click="emit('openSettings')">
        <span class="tier-menu__label">更改全局设置…</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.tier-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 300px;
  padding: var(--space-1-5);
}

.tier-menu__hint {
  margin: 0 0 var(--space-1);
  padding: var(--space-1-5) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}

.tier-menu__option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1-5) var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tier-menu__option:hover {
  background: var(--color-bg-hover);
}

.tier-menu__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tier-menu__label {
  font-size: var(--font-size-sm);
  line-height: 20px;
}

.tier-menu__option.is-full-access .tier-menu__label {
  color: var(--color-warning-text);
  font-weight: var(--font-weight-medium);
}

.tier-menu__option--link .tier-menu__label {
  color: var(--color-text-secondary);
}

.tier-menu__description {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}

.tier-menu__check {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  color: var(--color-text-primary);
}

.tier-menu__divider {
  height: 0.5px;
  margin: var(--space-1) var(--space-2);
  background: var(--color-border-default);
}
</style>
