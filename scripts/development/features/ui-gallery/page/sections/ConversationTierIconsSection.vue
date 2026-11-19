<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DropdownPanel, HoverTooltip, SegmentedTabs, Switch, type SegmentedTabItem } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import MockComposer from '../prototypes/MockComposer.vue';
import PermissionTierIcon from '../prototypes/PermissionTierIcon.vue';
import PermissionTierMenu from '../prototypes/PermissionTierMenu.vue';
import {
  PERMISSION_TIERS,
  TIER_LABELS,
  resolveTier,
  type ConversationTierSetting,
  type PermissionTier,
} from '../prototypes/permissionTier.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/**
 * 档位放到模型选择左边、完全访问去掉底色、换成图标三处改动的对比预览（用户 2026-11-18 提出）。
 * 已定：B1（2026-11-18 用户选定），正式图标为 renderer-ui 的 ShieldKeyholeIcon / ShieldCheckmarkIcon / ShieldErrorIcon。
 * 新对话还没发消息时不显示用量环。档位切换不弹完全访问确认框，确认框见“对话档位”分区。
 */
const globalTier = ref<PermissionTier>('standard');
const setting = ref<ConversationTierSetting>('full_access');
const draftConversation = ref(true);
const effectiveTier = computed(() => resolveTier(setting.value, globalTier.value));

const STATE_TABS: SegmentedTabItem[] = [
  { id: 'global', label: '跟随全局（标准）' },
  { id: 'read_only', label: '只读' },
  { id: 'standard', label: '标准' },
  { id: 'full_access', label: '完全访问' },
];

const tooltip = computed(() => (
  setting.value === 'global'
    ? `命令权限：${TIER_LABELS[globalTier.value]}（跟随全局设置）`
    : `命令权限：${TIER_LABELS[setting.value]}`
));

const ICON_SETS = [
  {
    id: 'shield',
    title: '方案 B1（已选定）：同一个盾牌，里面换符号',
    note: '锁孔＝只读，对勾＝标准，感叹号＝完全访问。外形一致，像一个档位刻度；三档之间靠内部符号区分，14–16px 下要稍看一眼。',
  },
  {
    id: 'mixed',
    title: '方案 B2：三个不同外形',
    note: '眼睛＝只看不改，盾牌对勾＝有保护，打开的锁＝不设防。外形各不相同，一眼能分；三个比喻不属于同一族。',
  },
] as const;

/** 顶部状态切换只改演示状态。 */
function setDemoState(id: string) {
  setting.value = id as ConversationTierSetting;
}

const openMenu = ref<string | null>(null);
function toggleMenu(key: string) {
  openMenu.value = openMenu.value === key ? null : key;
}
function select(value: ConversationTierSetting) {
  setting.value = value;
  openMenu.value = null;
}
function closeMenuOnOutside(event: PointerEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('.tier-anchor')) openMenu.value = null;
}
onMounted(() => document.addEventListener('pointerdown', closeMenuOnOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeMenuOnOutside));
</script>

<template>
  <div class="gallery-section tier-icons">
    <GalleryRow label="演示状态">
      <SegmentedTabs :model-value="setting" :tabs="STATE_TABS" aria-label="演示状态" @update:model-value="setDemoState" />
      <label class="tier-icons__switch">
        <Switch v-model="draftConversation" ariaLabel="新对话" />
        <span>新对话（还没发消息，不显示用量环）</span>
      </label>
    </GalleryRow>

    <GalleryBlock
      title="方案 A：保留文字，完全访问只改字色"
      note="档位放到模型选择左边。完全访问不再有底色，只用警示色文字加中等字重；悬停底色与其他底栏控件相同。"
    >
      <div class="tier-icons__grid">
        <figure v-for="variant in (['default', 'compact'] as const)" :key="variant" class="tier-icons__figure">
          <figcaption>{{ variant === 'default' ? '常规宽度' : '侧边对话' }}</figcaption>
          <MockComposer :variant="variant" :show-usage="!draftConversation">
            <template #before-model>
              <span class="tier-anchor">
                <button
                  type="button"
                  class="tier-text"
                  :class="{
                    'is-compact': variant === 'compact',
                    'is-full-access': effectiveTier === 'full_access',
                    'is-open': openMenu === `a-${variant}`,
                  }"
                  :title="tooltip"
                  @click="toggleMenu(`a-${variant}`)"
                >
                  <span>{{ TIER_LABELS[effectiveTier] }}</span>
                  <ChevronIcon direction="up" class="tier-text__chevron" />
                </button>
                <DropdownPanel :show="openMenu === `a-${variant}`" direction="up" class="tier-anchor__panel">
                  <PermissionTierMenu :model-value="setting" :global-tier="globalTier" @select="select" />
                </DropdownPanel>
              </span>
            </template>
          </MockComposer>
        </figure>
      </div>
    </GalleryBlock>

    <GalleryBlock v-for="iconSet in ICON_SETS" :key="iconSet.id" :title="iconSet.title" :note="iconSet.note">
      <div class="tier-icons__sheet">
        <div v-for="tier in PERMISSION_TIERS" :key="tier" class="tier-icons__cell" :class="{ 'is-full-access': tier === 'full_access' }">
          <PermissionTierIcon :tier="tier" :set="iconSet.id" class="tier-icons__large" />
          <span class="tier-icons__sizes">
            <PermissionTierIcon :tier="tier" :set="iconSet.id" class="tier-icons__16" />
            <PermissionTierIcon :tier="tier" :set="iconSet.id" class="tier-icons__14" />
          </span>
          <span class="tier-icons__label">{{ TIER_LABELS[tier] }}</span>
        </div>
      </div>
      <div class="tier-icons__grid">
        <figure v-for="variant in (['default', 'compact'] as const)" :key="variant" class="tier-icons__figure">
          <figcaption>{{ variant === 'default' ? '常规宽度' : '侧边对话' }}　悬停图标显示档位</figcaption>
          <MockComposer :variant="variant" :show-usage="!draftConversation">
            <template #before-model>
              <span class="tier-anchor">
                <HoverTooltip :text="tooltip" placement="top" :disabled="openMenu === `${iconSet.id}-${variant}`">
                  <button
                    type="button"
                    class="tier-icon-button"
                    :class="{
                      'is-compact': variant === 'compact',
                      'is-full-access': effectiveTier === 'full_access',
                      'is-open': openMenu === `${iconSet.id}-${variant}`,
                    }"
                    :aria-label="tooltip"
                    @click="toggleMenu(`${iconSet.id}-${variant}`)"
                  >
                    <PermissionTierIcon :tier="effectiveTier" :set="iconSet.id" />
                  </button>
                </HoverTooltip>
                <DropdownPanel :show="openMenu === `${iconSet.id}-${variant}`" direction="up" class="tier-anchor__panel">
                  <PermissionTierMenu :model-value="setting" :global-tier="globalTier" :icon-set="iconSet.id" @select="select" />
                </DropdownPanel>
              </span>
            </template>
          </MockComposer>
        </figure>
      </div>
    </GalleryBlock>
  </div>
</template>

<style scoped>
.tier-icons {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.tier-icons__switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.tier-icons__grid {
  display: grid;
  grid-template-columns: minmax(0, 640px) minmax(0, 360px);
  gap: var(--space-6);
  align-items: end;
  padding-top: var(--space-2);
}

.tier-icons__figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}

.tier-icons__figure figcaption {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.tier-anchor {
  position: relative;
  display: inline-flex;
  flex: none;
}

.tier-anchor__panel {
  bottom: calc(100% + 6px);
  left: 0;
}

/* 方案 A：与模型选择器同高的文字控件；完全访问只改字色。 */
.tier-text {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 26px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.tier-text.is-compact {
  height: 24px;
  padding: 0 var(--space-1-5);
}

.tier-text:hover,
.tier-text.is-open,
.tier-icon-button:hover,
.tier-icon-button.is-open {
  background: var(--color-bg-hover);
}

.tier-text.is-full-access {
  color: var(--color-warning-text);
  font-weight: var(--font-weight-medium);
}

.tier-text__chevron {
  width: 12px;
  height: 12px;
}

/* 方案 B：只有图标，尺寸同添加按钮。 */
.tier-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.tier-icon-button.is-compact {
  width: 24px;
  height: 24px;
}

.tier-icon-button svg {
  width: 16px;
  height: 16px;
}

.tier-icon-button.is-full-access {
  color: var(--color-warning-text);
}

.tier-icons__sheet {
  display: flex;
  gap: var(--space-6);
  margin-bottom: var(--space-2);
}

.tier-icons__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-primary);
}

.tier-icons__cell.is-full-access {
  color: var(--color-warning-text);
}

.tier-icons__large {
  width: 72px;
  height: 72px;
  background-image:
    linear-gradient(var(--color-border-light) 0.5px, transparent 0.5px),
    linear-gradient(90deg, var(--color-border-light) 0.5px, transparent 0.5px);
  background-size: 3px 3px;
}

.tier-icons__sizes {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.tier-icons__16 {
  width: 16px;
  height: 16px;
}

.tier-icons__14 {
  width: 14px;
  height: 14px;
}

.tier-icons__label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}
</style>
