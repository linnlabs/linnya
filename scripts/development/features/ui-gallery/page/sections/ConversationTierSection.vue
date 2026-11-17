<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  AlertDialog,
  BaseButton,
  CustomRadio,
  DropdownPanel,
  SegmentedTabs,
  Switch,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import MockComposer from '../prototypes/MockComposer.vue';
import PermissionTierMenu from '../prototypes/PermissionTierMenu.vue';
import {
  PERMISSION_TIERS,
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  fullAccessDialogCopy,
  resolveTier,
  tierSettingText,
  type ConversationTierSetting,
  type PermissionTier,
} from '../prototypes/permissionTier.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/* ---------- 输入框里的档位 ---------- */

const globalTier = ref<PermissionTier>('standard');
const setting = ref<ConversationTierSetting>('global');
const running = ref(false);
const effectiveTier = computed(() => resolveTier(setting.value, globalTier.value));

const STATE_TABS: SegmentedTabItem[] = [
  { id: 'global', label: '跟随全局' },
  { id: 'read_only', label: '只读' },
  { id: 'standard', label: '标准' },
  { id: 'full_access', label: '完全访问' },
];

/** 方案 B 放在底栏里，跟随全局时只写档位名，括号说明进悬停提示。 */
const pillText = computed(() => TIER_LABELS[effectiveTier.value]);
const pillTooltip = computed(() => (
  setting.value === 'global'
    ? `命令权限：${TIER_LABELS[globalTier.value]}（跟随全局设置）`
    : `命令权限：${TIER_LABELS[setting.value]}（只对这个对话）`
));
const menuHint = computed(() => (running.value ? '正在回复。修改从你发下一条消息开始生效。' : ''));

const openMenu = ref<string | null>(null);
function toggleMenu(key: string) {
  openMenu.value = openMenu.value === key ? null : key;
}
function closeMenuOnOutside(event: PointerEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('.tier-anchor')) openMenu.value = null;
}
onMounted(() => document.addEventListener('pointerdown', closeMenuOnOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeMenuOnOutside));

/* ---------- 切到完全访问：每次确认 ---------- */

const dialogContext = ref<'conversation' | 'scheduled-task' | null>(null);
const dialogCopy = computed(() => fullAccessDialogCopy(dialogContext.value ?? 'conversation'));
let pendingSetting: ConversationTierSetting | null = null;

function selectSetting(value: ConversationTierSetting) {
  openMenu.value = null;
  if (resolveTier(value, globalTier.value) === 'full_access' && effectiveTier.value !== 'full_access') {
    pendingSetting = value;
    dialogContext.value = 'conversation';
    return;
  }
  applySetting(value);
}

const auditLog = ref<{ from: string; to: string; time: string }[]>([]);
function applySetting(value: ConversationTierSetting) {
  const from = tierSettingText(setting.value, globalTier.value);
  setting.value = value;
  auditLog.value = [...auditLog.value, { from, to: tierSettingText(value, globalTier.value), time: '14:32' }];
}

function confirmDialog() {
  if (pendingSetting !== null) applySetting(pendingSetting);
  pendingSetting = null;
  dialogContext.value = null;
}
function cancelDialog() {
  pendingSetting = null;
  dialogContext.value = null;
}

/** 顶部状态切换直接改演示状态，不弹确认框。 */
function setDemoState(id: string) {
  setting.value = id as ConversationTierSetting;
}

/* ---------- 调低全局设置 ---------- */

const settingsTier = ref<PermissionTier>('full_access');
const lowerTarget = ref<PermissionTier | null>(null);
const lowerResult = ref('');
/** 原生单选框点下去就会选中；放弃修改后重建这一组，让显示回到当前值。 */
const settingsGroupKey = ref(0);
const OVERRIDE_COUNTS = { conversations: 3, tasks: 2 } as const;

function chooseGlobal(tier: PermissionTier) {
  if (tier === settingsTier.value) return;
  const lowering = PERMISSION_TIERS.indexOf(tier) < PERMISSION_TIERS.indexOf(settingsTier.value);
  if (lowering) {
    lowerTarget.value = tier;
    return;
  }
  settingsTier.value = tier;
  lowerResult.value = '';
}
const lowerMessage = computed(() => {
  const target = lowerTarget.value ? TIER_LABELS[lowerTarget.value] : '';
  return `有 ${OVERRIDE_COUNTS.conversations} 个对话和 ${OVERRIDE_COUNTS.tasks} 个定时任务单独设了“完全访问”，高于新的全局设置“${target}”。\n\n要把它们一起调到“${target}”吗？不调的话，它们仍按原来的档位运行。`;
});
function lowerAll() {
  if (!lowerTarget.value) return;
  settingsTier.value = lowerTarget.value;
  lowerResult.value = `全局设置和 ${OVERRIDE_COUNTS.conversations + OVERRIDE_COUNTS.tasks} 项单独设置都已调到“${TIER_LABELS[lowerTarget.value]}”。`;
  lowerTarget.value = null;
}
function lowerGlobalOnly() {
  if (!lowerTarget.value) return;
  settingsTier.value = lowerTarget.value;
  lowerResult.value = `只改了全局设置。${OVERRIDE_COUNTS.conversations} 个对话和 ${OVERRIDE_COUNTS.tasks} 个定时任务仍是“完全访问”。`;
  lowerTarget.value = null;
}
function abortLowering() {
  lowerTarget.value = null;
  settingsGroupKey.value += 1;
}
</script>

<template>
  <div class="gallery-section tier-preview">
    <GalleryBlock
      title="输入框里的档位"
      note="两种位置对比：A 在输入框下方单独一行，B 放进底栏、紧挨模型选择。点档位文字打开切换菜单；切到完全访问每次都弹确认框。上面两个开关只改演示状态。"
    >
      <GalleryRow label="演示状态">
        <SegmentedTabs :model-value="setting" :tabs="STATE_TABS" aria-label="演示状态" @update:model-value="setDemoState" />
        <label class="tier-preview__switch">
          <Switch v-model="running" ariaLabel="正在回复" />
          <span>正在回复</span>
        </label>
      </GalleryRow>

      <div class="tier-preview__grid">
        <figure class="tier-preview__figure">
          <figcaption>A　输入框下方一行（常规宽度）</figcaption>
          <div class="tier-preview__stage">
            <MockComposer :running="running">
              <template #below>
                <div class="tier-under">
                  <span class="tier-anchor">
                    <button
                      type="button"
                      class="tier-under__trigger"
                      :class="{ 'is-full-access': effectiveTier === 'full_access', 'is-open': openMenu === 'a' }"
                      :aria-expanded="openMenu === 'a'"
                      @click="toggleMenu('a')"
                    >
                      <span class="tier-under__prefix">权限</span>
                      <span>{{ tierSettingText(setting, globalTier) }}</span>
                      <ChevronIcon direction="down" class="tier-under__chevron" />
                    </button>
                    <DropdownPanel :show="openMenu === 'a'" direction="up" class="tier-anchor__panel">
                      <PermissionTierMenu :model-value="setting" :global-tier="globalTier" :hint="menuHint" @select="selectSetting" />
                    </DropdownPanel>
                  </span>
                </div>
              </template>
            </MockComposer>
          </div>
        </figure>

        <figure class="tier-preview__figure">
          <figcaption>B　底栏里、模型旁边（常规宽度）</figcaption>
          <div class="tier-preview__stage">
            <MockComposer :running="running">
              <template #footer-extra>
                <span class="tier-anchor">
                  <button
                    type="button"
                    class="tier-pill"
                    :class="{ 'is-full-access': effectiveTier === 'full_access', 'is-open': openMenu === 'b' }"
                    :title="pillTooltip"
                    :aria-expanded="openMenu === 'b'"
                    @click="toggleMenu('b')"
                  >
                    <span>{{ pillText }}</span>
                    <ChevronIcon direction="up" class="tier-pill__chevron" />
                  </button>
                  <DropdownPanel :show="openMenu === 'b'" direction="up" class="tier-anchor__panel">
                    <PermissionTierMenu :model-value="setting" :global-tier="globalTier" :hint="menuHint" @select="selectSetting" />
                  </DropdownPanel>
                </span>
              </template>
            </MockComposer>
          </div>
        </figure>

        <figure class="tier-preview__figure is-compact">
          <figcaption>A　侧边对话（紧凑宽度）</figcaption>
          <div class="tier-preview__stage">
            <MockComposer variant="compact" model="DeepSeek V4 Flash" :running="running">
              <template #below>
                <div class="tier-under is-compact">
                  <span class="tier-anchor">
                    <button
                      type="button"
                      class="tier-under__trigger"
                      :class="{ 'is-full-access': effectiveTier === 'full_access', 'is-open': openMenu === 'a-compact' }"
                      @click="toggleMenu('a-compact')"
                    >
                      <span class="tier-under__prefix">权限</span>
                      <span>{{ tierSettingText(setting, globalTier) }}</span>
                      <ChevronIcon direction="down" class="tier-under__chevron" />
                    </button>
                    <DropdownPanel :show="openMenu === 'a-compact'" direction="up" class="tier-anchor__panel">
                      <PermissionTierMenu :model-value="setting" :global-tier="globalTier" :hint="menuHint" @select="selectSetting" />
                    </DropdownPanel>
                  </span>
                </div>
              </template>
            </MockComposer>
          </div>
        </figure>

        <figure class="tier-preview__figure is-compact">
          <figcaption>B　侧边对话（紧凑宽度）</figcaption>
          <div class="tier-preview__stage">
            <MockComposer variant="compact" model="DeepSeek V4 Flash" :running="running">
              <template #footer-extra>
                <span class="tier-anchor">
                  <button
                    type="button"
                    class="tier-pill is-compact"
                    :class="{ 'is-full-access': effectiveTier === 'full_access', 'is-open': openMenu === 'b-compact' }"
                    :title="pillTooltip"
                    @click="toggleMenu('b-compact')"
                  >
                    <span>{{ pillText }}</span>
                    <ChevronIcon direction="up" class="tier-pill__chevron" />
                  </button>
                  <DropdownPanel :show="openMenu === 'b-compact'" direction="up" class="tier-anchor__panel">
                    <PermissionTierMenu :model-value="setting" :global-tier="globalTier" :hint="menuHint" @select="selectSetting" />
                  </DropdownPanel>
                </span>
              </template>
            </MockComposer>
          </div>
        </figure>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="改档位留下的记录"
      note="只有用户在界面上能改档位。改了以后对话里留一行记录，历史对话打开时也能看到当时用的档位。"
    >
      <div class="tier-timeline">
        <div class="tier-timeline__user">帮我整理一下 downloads 里的发票，按月份归档。</div>
        <div class="tier-timeline__answer">已按月份建好 12 个文件夹，移动了 48 张发票，另外 3 张识别不出日期，放在“待确认”里。</div>
        <div v-for="(entry, index) in auditLog" :key="index" class="tier-timeline__audit">
          你把这个对话的权限从“{{ entry.from }}”改为“{{ entry.to }}” · {{ entry.time }}
        </div>
        <div v-if="!auditLog.length" class="tier-timeline__audit">
          在上面的菜单里改一次档位，这里会出现记录。
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="完全访问的确认框"
      note="对话里沿用设置页的内容。定时任务在设置页的红字风险说明后面再加一段警告（确认框的风险说明改为支持分段）。"
    >
      <GalleryRow label="打开">
        <BaseButton variant="secondary" size="md" @click="dialogContext = 'conversation'">对话切到完全访问</BaseButton>
        <BaseButton variant="secondary" size="md" @click="dialogContext = 'scheduled-task'">定时任务选完全访问</BaseButton>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock
      title="调低全局设置时"
      note="全局设置调低后，单独设了更高档位的对话和定时任务不会自动跟着变。这时问一次是否一起调低；关闭对话框等于取消这次修改。"
    >
      <div class="tier-settings">
        <div class="tier-settings__title">命令权限</div>
        <label v-for="tier in PERMISSION_TIERS" :key="`${tier}-${settingsGroupKey}`" class="tier-settings__option">
          <CustomRadio :model-value="settingsTier" :value="tier" name="gallery-global-tier" @update:model-value="chooseGlobal" />
          <span class="tier-settings__text">
            <span class="tier-settings__label">{{ TIER_LABELS[tier] }}</span>
            <span class="tier-settings__description">{{ TIER_DESCRIPTIONS[tier] }}</span>
          </span>
        </label>
        <p v-if="lowerResult" class="tier-settings__result">{{ lowerResult }}</p>
      </div>
    </GalleryBlock>

    <AlertDialog
      :visible="dialogContext !== null"
      is-confirmation
      is-dangerous-action
      :width="dialogContext === 'scheduled-task' ? '560px' : '520px'"
      :title="dialogCopy.title"
      :message="dialogCopy.message"
      :sections="dialogCopy.sections"
      :risk-message="dialogCopy.riskMessage"
      :confirm-text="dialogCopy.confirmText"
      :cancel-text="dialogCopy.cancelText"
      @confirm="confirmDialog"
      @cancel="cancelDialog"
    />

    <AlertDialog
      :visible="lowerTarget !== null"
      is-confirmation
      :close-is-cancel="false"
      width="460px"
      title="单独设置的档位要一起调低吗？"
      :message="lowerMessage"
      :confirm-text="`一起调到${lowerTarget ? TIER_LABELS[lowerTarget] : ''}`"
      cancel-text="只改全局设置"
      @confirm="lowerAll"
      @cancel="lowerGlobalOnly"
      @close="abortLowering"
    />
  </div>
</template>

<style scoped>
.tier-preview__switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.tier-preview__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 640px));
  gap: var(--space-6) var(--space-8);
  margin-top: var(--space-4);
}

.tier-preview__figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.tier-preview__figure figcaption {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

/* 菜单向上展开，给它留出位置；底色模拟对话区。 */
.tier-preview__stage {
  display: flex;
  align-items: flex-end;
  min-height: 400px;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-bg-default);
  box-shadow: 0 0 0 1px var(--color-border-light);
}

.tier-preview__figure.is-compact .tier-preview__stage {
  max-width: 360px;
  padding: var(--space-2-5);
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

/* A：输入框下方一行，与输入框内文字左对齐。 */
.tier-under {
  display: flex;
  padding: var(--space-1-5) var(--space-2) 0;
}

.tier-under.is-compact {
  padding: var(--space-1) var(--space-1) 0;
}

.tier-under__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 24px;
  padding: 0 var(--space-1-5);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  font: inherit;
  font-size: var(--font-size-caption);
  cursor: pointer;
}

.tier-under__trigger:hover,
.tier-under__trigger.is-open {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.tier-under__prefix {
  color: var(--color-text-placeholder);
}

.tier-under__trigger.is-full-access {
  color: var(--color-warning-text);
  font-weight: var(--font-weight-medium);
}

.tier-under__trigger.is-full-access .tier-under__prefix {
  color: inherit;
  font-weight: normal;
}

.tier-under__chevron {
  width: 12px;
  height: 12px;
}

/* B：与模型选择器同高的底栏控件。 */
.tier-pill {
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

.tier-pill.is-compact {
  height: 24px;
  padding: 0 var(--space-1-5);
}

.tier-pill:hover,
.tier-pill.is-open {
  background: var(--color-bg-hover);
}

.tier-pill.is-full-access {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  font-weight: var(--font-weight-medium);
}

.tier-pill__chevron {
  width: 12px;
  height: 12px;
}

.tier-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 640px;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--color-bg-default);
  box-shadow: 0 0 0 1px var(--color-border-light);
  font-size: var(--font-size-prose);
  line-height: 1.7;
}

.tier-timeline__user {
  align-self: flex-end;
  max-width: 80%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}

.tier-timeline__answer {
  color: var(--color-text-primary);
}

.tier-timeline__audit {
  align-self: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.tier-settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 520px;
}

.tier-settings__title {
  margin-bottom: var(--space-1);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.tier-settings__option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  cursor: pointer;
}

.tier-settings__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tier-settings__label {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.tier-settings__description {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.tier-settings__result {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
