<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  ActionButtons,
  BaseButton,
  SegmentedTabs,
  Switch,
  TagChip,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { AppsIcon, LibraryIcon } from '@linnya/renderer-ui/icons';
import '@/domains/plugin-store/styles/components/PluginStoreView.css';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/* 真实体积：知识库插件 zip 与 Qdrant 1.14.1 运行时组件（macOS arm64）的实际打包结果。 */
const MB = 1024 * 1024;
const PLUGIN_DOWNLOAD = 2_484_698;
const RUNTIME_DOWNLOAD = 24_698_177;
const TOTAL_DOWNLOAD = PLUGIN_DOWNLOAD + RUNTIME_DOWNLOAD;
const INSTALLED_SIZE = 12_376_277 + 64_440_240;
const KNOWLEDGE_DESCRIPTION = '上传资料，建立可检索的个人知识库，对话时引用原文。';

function formatBytes(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* ---------- 列表 ---------- */

type ChipTone = 'success' | 'warning' | 'error';

interface StoreCard {
  readonly key: string;
  readonly caption: string;
  readonly chip: { readonly label: string; readonly tone: ChipTone };
  readonly meta: readonly string[];
  readonly progress?: number;
  readonly action:
    | { readonly kind: 'switch' }
    | { readonly kind: 'button'; readonly text: string; readonly disabled?: boolean }
    | { readonly kind: 'none' };
}

const STORE_CARDS: readonly StoreCard[] = [
  {
    key: 'available',
    caption: '可安装（远程）',
    chip: { label: '未安装', tone: 'warning' },
    meta: ['版本 0.2.0', `下载 ${formatBytes(TOTAL_DOWNLOAD)}`],
    action: { kind: 'button', text: '安装' },
  },
  {
    key: 'installing',
    caption: '安装中',
    chip: { label: '安装中', tone: 'warning' },
    meta: [`正在下载 ${formatBytes(12.4 * MB)} / ${formatBytes(TOTAL_DOWNLOAD)}`],
    progress: (12.4 * MB) / TOTAL_DOWNLOAD,
    action: { kind: 'none' },
  },
  {
    key: 'failed',
    caption: '安装失败',
    chip: { label: '安装失败', tone: 'error' },
    meta: ['网络连接中断，请在详情页重试'],
    action: { kind: 'button', text: '重试' },
  },
  {
    key: 'update',
    caption: '可更新（已安装）',
    chip: { label: '有新版本', tone: 'warning' },
    meta: ['当前 0.2.0，可更新到 0.2.1', `下载 ${formatBytes(PLUGIN_DOWNLOAD)}`],
    action: { kind: 'button', text: '更新' },
  },
];

const offline = ref(false);

/* ---------- 详情页 ---------- */

type DetailState = 'available' | 'downloading' | 'cancelled' | 'failed' | 'installed';
type FailureReason = 'network' | 'integrity' | 'disk' | 'incompatible' | 'service';

const DETAIL_TABS: SegmentedTabItem[] = [
  { id: 'available', label: '未安装' },
  { id: 'downloading', label: '下载中' },
  { id: 'cancelled', label: '已取消' },
  { id: 'failed', label: '安装失败' },
  { id: 'installed', label: '已安装' },
];

const FAILURES: Record<FailureReason, { readonly label: string; readonly message: string; readonly action: string | null }> = {
  network: {
    label: '网络中断',
    message: '下载中断：网络连接失败。未完成的下载内容已丢弃，原有插件不受影响。',
    action: '重试',
  },
  integrity: {
    label: '校验失败',
    message: '下载内容未通过完整性校验，已丢弃，未做任何安装。请稍后重试；如果反复出现，请联系我们。',
    action: '重试',
  },
  disk: {
    label: '磁盘空间不足',
    message: `磁盘空间不足：安装需要约 ${formatBytes(INSTALLED_SIZE + TOTAL_DOWNLOAD)} 可用空间，当前剩余 35.0 MB。释放空间后重试。`,
    action: '重试',
  },
  incompatible: {
    label: '需要更新 Linnya',
    message: '知识库 0.2.0 需要 Linnya 0.3.0 或更高版本。请先更新 Linnya。',
    action: null,
  },
  service: {
    label: '服务不可用',
    message: '插件服务暂时不可用，请稍后重试。已安装的插件不受影响。',
    action: '重试',
  },
};

const FAILURE_TABS: SegmentedTabItem[] = (Object.keys(FAILURES) as FailureReason[]).map(id => ({ id, label: FAILURES[id].label }));

interface Phase {
  readonly label: string;
  readonly bytes: number;
}

const PHASES: readonly Phase[] = [
  { label: '正在下载向量检索组件', bytes: RUNTIME_DOWNLOAD },
  { label: '正在下载知识库', bytes: PLUGIN_DOWNLOAD },
  { label: '正在校验并安装', bytes: 0 },
];

const detailState = ref<DetailState>('available');
const failureReason = ref<FailureReason>('network');
const phaseIndex = ref(0);
const phaseDone = ref(0);
const notice = ref('');

let timer: ReturnType<typeof setInterval> | null = null;
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}
onBeforeUnmount(stopTimer);

function selectState(id: string) {
  stopTimer();
  notice.value = '';
  detailState.value = id as DetailState;
  phaseIndex.value = id === 'downloading' ? 0 : 0;
  phaseDone.value = id === 'downloading' ? 12.4 * MB : 0;
}

function startInstall() {
  stopTimer();
  notice.value = '';
  detailState.value = 'downloading';
  phaseIndex.value = 0;
  phaseDone.value = 0;
  timer = setInterval(() => {
    const phase = PHASES[phaseIndex.value]!;
    if (phase.bytes === 0) {
      stopTimer();
      detailState.value = 'installed';
      notice.value = '知识库 已安装并启用';
      return;
    }
    phaseDone.value = Math.min(phase.bytes, phaseDone.value + phase.bytes / 12);
    if (phaseDone.value >= phase.bytes) {
      phaseIndex.value += 1;
      phaseDone.value = 0;
    }
  }, 160);
}

function cancelInstall() {
  stopTimer();
  detailState.value = 'cancelled';
  notice.value = '';
}

const currentPhase = computed(() => PHASES[phaseIndex.value]!);
const downloadedTotal = computed(() =>
  PHASES.slice(0, phaseIndex.value).reduce((sum, phase) => sum + phase.bytes, 0) + phaseDone.value);
const progressRatio = computed(() => Math.min(1, downloadedTotal.value / TOTAL_DOWNLOAD));
const phaseText = computed(() => currentPhase.value.bytes === 0
  ? currentPhase.value.label
  : `${currentPhase.value.label} · ${formatBytes(phaseDone.value)} / ${formatBytes(currentPhase.value.bytes)}`);

const detailChip = computed((): { label: string; tone: ChipTone } => {
  switch (detailState.value) {
    case 'installed': return { label: '已启用', tone: 'success' };
    case 'downloading': return { label: '安装中', tone: 'warning' };
    case 'failed': return { label: '安装失败', tone: 'error' };
    default: return { label: '未安装', tone: 'warning' };
  }
});
</script>

<template>
  <div class="plugin-remote">
    <GalleryBlock
      title="插件市场列表"
      note="远程插件在安装前就显示名称、简介与下载大小（含所需运行时组件）。列表只显示进度与结果，取消与失败原因在详情页处理。"
    >
      <GalleryRow label="联网状态">
        <SegmentedTabs
          :model-value="offline ? 'offline' : 'online'"
          :tabs="[{ id: 'online', label: '在线' }, { id: 'offline', label: '无法连接插件服务' }]"
          aria-label="联网状态"
          @update:model-value="value => (offline = value === 'offline')"
        />
      </GalleryRow>
      <div class="plugin-store-view plugin-remote__surface">
        <p v-if="offline" class="plugin-store-availability" role="status">
          暂时无法连接插件服务，不能安装或更新插件。已安装的插件不受影响。
        </p>
        <div class="plugin-store-list plugin-remote__cards">
          <div v-for="card in STORE_CARDS" :key="card.key" class="plugin-remote__card-row">
            <span class="plugin-remote__caption">{{ card.caption }}</span>
            <article class="plugin-store-card" tabindex="0" :aria-label="`知识库：${card.caption}`">
              <div class="plugin-store-card-main">
                <div class="plugin-store-card-heading">
                  <span class="plugin-store-plugin-symbol">
                    <LibraryIcon class="plugin-store-plugin-symbol-component" />
                  </span>
                  <h2>知识库</h2>
                  <TagChip
                    class="plugin-store-state-chip"
                    :class="`is-${card.chip.tone}`"
                    :label="card.chip.label"
                    :class-names="{ label: 'plugin-store-state-chip-label' }"
                  />
                </div>
                <p class="plugin-store-card-description">{{ KNOWLEDGE_DESCRIPTION }}</p>
                <div class="plugin-store-card-meta">
                  <span v-for="item in card.meta" :key="item">{{ item }}</span>
                </div>
                <div v-if="card.progress !== undefined" class="plugin-remote__progress" role="progressbar"
                  :aria-valuenow="Math.round(card.progress * 100)" aria-valuemin="0" aria-valuemax="100">
                  <span class="plugin-remote__progress-fill" :style="{ width: `${card.progress * 100}%` }" />
                </div>
              </div>
              <div class="plugin-store-card-actions">
                <ActionButtons
                  v-if="card.action.kind === 'button'"
                  class="plugin-store-install-actions"
                  :primary-action-text="card.action.text"
                  :primary-button-attributes="{ class: 'plugin-store-install-button' }"
                  :is-primary-action-disabled="offline || card.action.disabled === true"
                  :show-secondary-action="false"
                />
              </div>
            </article>
          </div>
          <div class="plugin-remote__card-row">
            <span class="plugin-remote__caption">随包插件（不受联网影响）</span>
            <article class="plugin-store-card" tabindex="0" aria-label="Slides：已启用">
              <div class="plugin-store-card-main">
                <div class="plugin-store-card-heading">
                  <span class="plugin-store-plugin-symbol">
                    <AppsIcon class="plugin-store-plugin-symbol-component" />
                  </span>
                  <h2>Slides</h2>
                  <TagChip class="plugin-store-state-chip is-success" label="已启用" :class-names="{ label: 'plugin-store-state-chip-label' }" />
                </div>
                <p class="plugin-store-card-description">用对话生成和编辑演示文稿。</p>
                <div class="plugin-store-card-meta"><span>版本 1.1.2</span><span>开发者 Linnya</span></div>
              </div>
              <div class="plugin-store-card-actions">
                <Switch :model-value="true" ariaLabel="启用 Slides" />
              </div>
            </article>
          </div>
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="插件详情：下载与安装"
      note="点“安装”模拟真实流程：先下载向量检索组件，再下载知识库，最后校验并安装；下载中可取消。失败时说明原因与可做的事，原有插件与数据不受影响。"
    >
      <div class="plugin-remote__controls">
        <GalleryRow label="状态">
          <div class="plugin-remote__state-row">
            <SegmentedTabs :model-value="detailState" :tabs="DETAIL_TABS" aria-label="详情页状态" @update:model-value="selectState" />
            <BaseButton variant="ghost" size="sm" @click="selectState('available')">重置</BaseButton>
          </div>
        </GalleryRow>
        <GalleryRow label="失败原因">
          <SegmentedTabs
            :model-value="failureReason"
            :tabs="FAILURE_TABS"
            aria-label="失败原因"
            @update:model-value="value => (failureReason = value as FailureReason)"
          />
        </GalleryRow>
      </div>

      <div class="plugin-store-view plugin-remote__surface">
        <section class="plugin-store-detail">
          <section class="plugin-store-detail-hero">
            <div class="plugin-store-detail-hero-main">
              <div class="plugin-store-detail-title-line">
                <span class="plugin-store-plugin-symbol">
                  <LibraryIcon class="plugin-store-plugin-symbol-component" />
                </span>
                <h1>知识库</h1>
                <TagChip
                  class="plugin-store-state-chip"
                  :class="`is-${detailChip.tone}`"
                  :label="detailChip.label"
                  :class-names="{ label: 'plugin-store-state-chip-label' }"
                />
              </div>
              <p>{{ KNOWLEDGE_DESCRIPTION }}</p>
            </div>
            <div class="plugin-store-detail-actions">
              <Switch v-if="detailState === 'installed'" :model-value="true" ariaLabel="启用知识库" />
              <ActionButtons
                v-else-if="detailState === 'downloading'"
                class="plugin-store-install-actions"
                secondary-action-text="取消"
                :show-primary-action="false"
                @secondary-click="cancelInstall"
              />
              <ActionButtons
                v-else-if="detailState !== 'failed' || FAILURES[failureReason].action"
                class="plugin-store-install-actions"
                :primary-action-text="detailState === 'failed' ? FAILURES[failureReason].action ?? '' : '安装'"
                :primary-button-attributes="{ class: 'plugin-store-install-button' }"
                :show-secondary-action="false"
                @primary-click="startInstall"
              />
            </div>
          </section>

          <div v-if="detailState === 'downloading'" class="plugin-remote__install-status" role="status">
            <div class="plugin-remote__install-line">
              <span>{{ phaseText }}</span>
              <span class="plugin-remote__percent">{{ Math.round(progressRatio * 100) }}%</span>
            </div>
            <div class="plugin-remote__progress" role="progressbar" :aria-valuenow="Math.round(progressRatio * 100)" aria-valuemin="0" aria-valuemax="100">
              <span class="plugin-remote__progress-fill" :style="{ width: `${progressRatio * 100}%` }" />
            </div>
            <p class="plugin-remote__hint">共 {{ formatBytes(TOTAL_DOWNLOAD) }}。可以离开此页，安装会在后台继续。</p>
          </div>
          <p v-else-if="detailState === 'cancelled'" class="plugin-remote__hint plugin-remote__install-status" role="status">
            已取消安装，未完成的下载内容已丢弃。
          </p>
          <p v-else-if="detailState === 'failed'" class="plugin-remote__error plugin-remote__install-status" role="alert">
            {{ FAILURES[failureReason].message }}
          </p>
          <p v-if="notice" class="plugin-remote__toast" role="status">✓ {{ notice }}</p>

          <section class="plugin-store-detail-section">
            <h2>介绍</h2>
            <p>保存资料原文与检索索引，支持项目关联、知识检索和引用。</p>
          </section>

          <dl class="plugin-store-detail-facts plugin-remote__facts">
            <div><dt>版本</dt><dd>0.2.0</dd></div>
            <div><dt>开发者</dt><dd>Linnya</dd></div>
            <div v-if="detailState === 'installed'"><dt>大小</dt><dd>{{ formatBytes(INSTALLED_SIZE) }}</dd></div>
            <div v-else><dt>大小</dt><dd>下载 {{ formatBytes(TOTAL_DOWNLOAD) }}，安装后约 {{ formatBytes(INSTALLED_SIZE) }}</dd></div>
          </dl>
          <p v-if="detailState !== 'installed'" class="plugin-remote__hint">
            包含知识库所需的向量检索组件（Qdrant 1.14.1，{{ formatBytes(RUNTIME_DOWNLOAD) }}）。本机已有该组件时不重复下载。
          </p>
        </section>
      </div>
    </GalleryBlock>
  </div>
</template>

<style scoped>
.plugin-remote {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.plugin-remote__surface {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
}

.plugin-remote__cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.plugin-remote__card-row {
  display: grid;
  grid-template-columns: 9em 1fr;
  align-items: center;
  gap: var(--space-3);
}

.plugin-remote__caption {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.plugin-remote__controls {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.plugin-remote__state-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 与知识库上传列表进度条同一参数：5px 轨道、强调色填充。 */
.plugin-remote__progress {
  height: 5px;
  margin-top: var(--space-2);
  background-color: var(--color-bg-hover);
  border-radius: var(--radius-xs);
  overflow: hidden;
}

.plugin-remote__progress-fill {
  display: block;
  height: 100%;
  background-color: var(--color-accent);
  transition: width var(--duration-long) var(--ease-standard);
}

.plugin-remote__install-status {
  margin: var(--space-3) 0 var(--space-4);
}

.plugin-remote__install-line {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-footnote);
  color: var(--color-text-secondary);
}

.plugin-remote__percent {
  font-variant-numeric: tabular-nums;
}

.plugin-remote__hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-caption);
  color: var(--color-text-tertiary);
}

.plugin-remote__error {
  font-size: var(--font-size-footnote);
  color: var(--color-error-text);
}

/* 新增色调：商店现有标签只有“已启用”（强调色）与中性灰，安装失败需要能一眼认出。 */
.plugin-remote :deep(.plugin-store-state-chip.is-error) {
  color: var(--color-error-text);
  background-color: var(--color-error-bg-subtle);
}

.plugin-remote__toast {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-footnote);
  color: var(--color-success-text, var(--color-text-secondary));
}
</style>
