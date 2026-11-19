<script setup lang="ts">
import { computed, onBeforeUnmount, ref, type Component } from 'vue';
import {
  ActionButtons,
  AlertDialog,
  BaseButton,
  CustomCheckbox,
  Modal,
  SegmentedTabs,
  Switch,
  TagChip,
  type AlertDialogSection,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { AppsIcon, DeleteIcon, LibraryIcon } from '@linnya/renderer-ui/icons';
import '@/domains/plugin-store/styles/components/PluginStoreView.css';
import PluginDataPanel, { type PluginDataPanelState } from '../prototypes/PluginDataPanel.vue';
import {
  CLEANUP_FAILURE_LABELS,
  KNOWLEDGE_DATA_ROWS,
  KNOWLEDGE_RECORDS_TEXT,
  LEFTOVER_DATA_ROWS,
  formatBytes,
  sumBytes,
  type CleanupFailureReason,
  type PluginDataRow,
} from '../prototypes/pluginDataDemo.ts';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const KNOWLEDGE_TOTAL = sumBytes(KNOWLEDGE_DATA_ROWS);
const LEFTOVER_TOTAL = sumBytes(LEFTOVER_DATA_ROWS);
const MB = 1024 * 1024;

/* ---------- 列表 ---------- */

type ChipTone = 'success' | 'warning' | 'attention';

interface StoreCard {
  readonly key: string;
  readonly caption: string;
  readonly name: string;
  readonly icon: Component;
  readonly description: string;
  readonly chip: { readonly label: string; readonly tone: ChipTone };
  readonly meta: readonly string[];
  readonly action:
    | { readonly kind: 'switch'; readonly on: boolean }
    | { readonly kind: 'button'; readonly text: string; readonly disabled?: boolean };
}

const UNINSTALL_MESSAGE = '卸载后，知识库的页面、工具和技能将被移除。数据默认保留在本机，重新安装后可继续使用。';
const DELETE_RISK = '数据删除后不可恢复，原文需重新上传；对话中已有的引用将显示为“来源已删除”。';
const KNOWLEDGE_DESCRIPTION = '上传资料，建立可检索的个人知识库，对话时引用原文。';

const STORE_CARDS: readonly StoreCard[] = [
  {
    key: 'slides',
    caption: '已安装',
    name: 'Slides',
    icon: AppsIcon,
    description: '用对话生成和编辑演示文稿。',
    chip: { label: '已启用', tone: 'success' },
    meta: ['版本 0.1.0', '开发者 Linnya'],
    action: { kind: 'switch', on: true },
  },
  {
    key: 'fresh',
    caption: '未安装（新用户）',
    name: '知识库',
    icon: LibraryIcon,
    description: KNOWLEDGE_DESCRIPTION,
    chip: { label: '未安装', tone: 'warning' },
    meta: ['版本 0.1.0', '开发者 Linnya'],
    action: { kind: 'button', text: '安装' },
  },
  {
    key: 'kept',
    caption: '已卸载，保留数据',
    name: '知识库',
    icon: LibraryIcon,
    description: KNOWLEDGE_DESCRIPTION,
    chip: { label: '未安装', tone: 'warning' },
    meta: ['版本 0.1.0', `本机保留数据 ${formatBytes(KNOWLEDGE_TOTAL)}`],
    action: { kind: 'button', text: '重新安装' },
  },
  {
    key: 'leftover',
    caption: '早期版本遗留数据',
    name: '知识库',
    icon: LibraryIcon,
    description: KNOWLEDGE_DESCRIPTION,
    chip: { label: '未安装', tone: 'warning' },
    meta: ['版本 0.1.0', `可清理数据 ${formatBytes(LEFTOVER_TOTAL)}`],
    action: { kind: 'button', text: '安装' },
  },
  {
    key: 'cleaning',
    caption: '清理中',
    name: '知识库',
    icon: LibraryIcon,
    description: KNOWLEDGE_DESCRIPTION,
    chip: { label: '清理中', tone: 'warning' },
    meta: [`正在清理：已完成 ${formatBytes(620 * MB)}，剩余 ${formatBytes(590 * MB)}`],
    action: { kind: 'button', text: '安装', disabled: true },
  },
  {
    key: 'incomplete',
    caption: '数据残留',
    name: '知识库',
    icon: LibraryIcon,
    description: KNOWLEDGE_DESCRIPTION,
    chip: { label: '数据残留', tone: 'attention' },
    meta: [`残留数据 ${formatBytes(340 * MB)}，请在详情页处理`],
    action: { kind: 'button', text: '安装', disabled: true },
  },
];

/* ---------- 卸载对话框 ---------- */

type DialogId = 'knowledge' | 'knowledge-busy' | 'slides' | 'blocked' | null;
const openDialog = ref<DialogId>(null);
const deleteDataChecked = ref(false);
const dialogResult = ref('');

function openUninstall(id: Exclude<DialogId, null>) {
  deleteDataChecked.value = false;
  dialogResult.value = '';
  openDialog.value = id;
}

function closeDialog() {
  openDialog.value = null;
}

function confirmKnowledgeUninstall() {
  dialogResult.value = deleteDataChecked.value
    ? `确认后：卸载完成并开始清理数据，完成后提示“知识库已卸载，已释放 ${formatBytes(KNOWLEDGE_TOTAL)}”。`
    : `确认后：提示“知识库已卸载，本机保留数据 ${formatBytes(KNOWLEDGE_TOTAL)}”。`;
  closeDialog();
}

/* ---------- 详情页 ---------- */

type DetailTab = 'installed' | 'uninstalled' | 'leftover' | 'cleaning' | 'incomplete';

const DETAIL_TABS: SegmentedTabItem[] = [
  { id: 'installed', label: '已安装' },
  { id: 'uninstalled', label: '已卸载（保留数据）' },
  { id: 'leftover', label: '早期版本遗留数据' },
  { id: 'cleaning', label: '清理中' },
  { id: 'incomplete', label: '数据残留' },
];

const FAILURE_TABS: SegmentedTabItem[] = (Object.keys(CLEANUP_FAILURE_LABELS) as CleanupFailureReason[]).map(id => ({
  id,
  label: CLEANUP_FAILURE_LABELS[id],
}));

const OUTCOME_TABS: SegmentedTabItem[] = [
  { id: 'success', label: '清理成功' },
  { id: 'fail', label: '清理失败' },
];

const detailTab = ref<DetailTab>('installed');
const panelState = ref<PluginDataPanelState>('installed');
const failureReason = ref<CleanupFailureReason>('busy');
const outcome = ref<'success' | 'fail'>('fail');
const attempts = ref(1);
const lastAttemptText = ref('上次清理：今天 14:32');
const cleanedBytes = ref(620 * MB);
const remainingBytes = ref(590 * MB);
const notice = ref('');
const deleteConfirmVisible = ref(false);
const deleteConfirmRows = ref<readonly PluginDataRow[]>(KNOWLEDGE_DATA_ROWS);

let timer: ReturnType<typeof setTimeout> | null = null;
function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}
onBeforeUnmount(clearTimer);

function selectDetailTab(id: string) {
  clearTimer();
  notice.value = '';
  detailTab.value = id as DetailTab;
  attempts.value = 1;
  lastAttemptText.value = '上次清理：今天 14:32';
  cleanedBytes.value = 620 * MB;
  remainingBytes.value = id === 'incomplete' ? 340 * MB : 590 * MB;
  panelState.value = id as PluginDataPanelState;
}

const detailRows = computed(() => (detailTab.value === 'leftover' ? LEFTOVER_DATA_ROWS : KNOWLEDGE_DATA_ROWS));

const detailChip = computed((): { label: string; tone: ChipTone } => {
  switch (panelState.value) {
    case 'installed':
      return { label: '已启用', tone: 'success' };
    case 'cleaning':
      return { label: '清理中', tone: 'warning' };
    case 'incomplete':
    case 'retrying':
      return { label: '数据残留', tone: 'attention' };
    default:
      return { label: '未安装', tone: 'warning' };
  }
});

const installText = computed(() => (panelState.value === 'uninstalled' ? '重新安装' : '安装'));
const installBlocked = computed(() =>
  panelState.value === 'cleaning' || panelState.value === 'incomplete' || panelState.value === 'retrying'
);

const deleteConfirmSections = computed((): AlertDialogSection[] => [
  {
    title: `将删除 ${formatBytes(sumBytes(deleteConfirmRows.value))} 数据`,
    items: deleteConfirmRows.value.map(row => `${row.label}　${formatBytes(row.bytes)}`),
  },
]);

function requestDelete() {
  deleteConfirmRows.value = detailRows.value;
  deleteConfirmVisible.value = true;
}

/** 演示清理过程：按“清理结果”选项，成功或停在所选失败原因上。 */
function startCleaning(total: number) {
  clearTimer();
  notice.value = '';
  cleanedBytes.value = 0;
  remainingBytes.value = total;
  panelState.value = 'cleaning';
  const stopAt = outcome.value === 'success' ? total : total - 340 * MB;
  const step = () => {
    cleanedBytes.value = Math.min(stopAt, cleanedBytes.value + Math.max(40 * MB, total / 8));
    remainingBytes.value = total - cleanedBytes.value;
    if (cleanedBytes.value < stopAt) {
      timer = setTimeout(step, 260);
      return;
    }
    finishAttempt(total);
  };
  timer = setTimeout(step, 260);
}

function finishAttempt(total: number) {
  timer = null;
  if (outcome.value === 'success') {
    panelState.value = 'uninstalled-empty';
    notice.value = `提示：知识库数据已删除，已释放 ${formatBytes(total)}`;
    return;
  }
  panelState.value = 'incomplete';
  lastAttemptText.value = '上次清理：刚刚';
  notice.value = `提示：数据清理未完成，残留 ${formatBytes(remainingBytes.value)}。可在插件详情页重试。`;
}

function confirmDelete() {
  deleteConfirmVisible.value = false;
  startCleaning(sumBytes(deleteConfirmRows.value));
}

function stopCleaning() {
  clearTimer();
  failureReason.value = 'stopped';
  panelState.value = 'incomplete';
  lastAttemptText.value = '上次清理：刚刚';
  notice.value = '';
}

function retry() {
  clearTimer();
  notice.value = '';
  panelState.value = 'retrying';
  timer = setTimeout(() => {
    timer = null;
    if (outcome.value === 'success') {
      panelState.value = 'uninstalled-empty';
      notice.value = `提示：残留数据已清理，已释放 ${formatBytes(remainingBytes.value)}`;
      return;
    }
    attempts.value += 1;
    lastAttemptText.value = '上次清理：刚刚';
    panelState.value = 'incomplete';
  }, 1500);
}

function reveal() {
  notice.value = '点击后：在访达中定位相关文件。';
}
</script>

<template>
  <div class="plugin-data">
    <GalleryBlock
      title="插件列表"
      note="插件市场页签。列表只显示状态与占用，清理失败等问题在详情页处理，列表不提供重试。"
    >
      <div class="plugin-store-view plugin-data__surface">
        <p class="plugin-store-availability">
          当前版本的插件随应用提供，支持安装、启停和卸载。远程安装与更新暂未开放。
        </p>
        <div class="plugin-data__cards">
          <div v-for="card in STORE_CARDS" :key="card.key" class="plugin-data__card-row">
            <span class="plugin-data__caption">{{ card.caption }}</span>
            <article class="plugin-store-card" tabindex="0" :aria-label="`${card.name}：${card.caption}`">
              <div class="plugin-store-card-main">
                <div class="plugin-store-card-heading">
                  <span class="plugin-store-plugin-symbol">
                    <component :is="card.icon" class="plugin-store-plugin-symbol-component" />
                  </span>
                  <h2>{{ card.name }}</h2>
                  <TagChip
                    class="plugin-store-state-chip"
                    :class="`is-${card.chip.tone}`"
                    :label="card.chip.label"
                    :class-names="{ label: 'plugin-store-state-chip-label' }"
                  />
                </div>
                <p class="plugin-store-card-description">{{ card.description }}</p>
                <div class="plugin-store-card-meta">
                  <span v-for="item in card.meta" :key="item">{{ item }}</span>
                </div>
              </div>
              <div class="plugin-store-card-actions">
                <Switch v-if="card.action.kind === 'switch'" :model-value="card.action.on" ariaLabel="启用" />
                <ActionButtons
                  v-else
                  class="plugin-store-install-actions"
                  :primary-action-text="card.action.text"
                  :primary-button-attributes="{ class: 'plugin-store-install-button' }"
                  :is-primary-action-disabled="card.action.disabled === true"
                  :show-secondary-action="false"
                />
              </div>
            </article>
          </div>
        </div>
      </div>
    </GalleryBlock>

    <GalleryBlock
      title="卸载确认"
      note="默认仅卸载并保留数据。勾选“同时删除”后展开待删除内容，确认按钮变为危险样式；仅需确认一次。"
    >
      <GalleryRow label="打开">
        <div class="plugin-data__buttons">
          <ActionButtons primary-action-text="知识库" :show-secondary-action="false" @primary-click="openUninstall('knowledge')" />
          <ActionButtons primary-action-text="知识库（导入进行中）" :show-secondary-action="false" @primary-click="openUninstall('knowledge-busy')" />
          <ActionButtons primary-action-text="Slides（无删除数据选项）" :show-secondary-action="false" @primary-click="openUninstall('slides')" />
          <ActionButtons primary-action-text="知识库（检索进行中）" :show-secondary-action="false" @primary-click="openUninstall('blocked')" />
        </div>
      </GalleryRow>
      <p v-if="dialogResult" class="plugin-data__notice" role="status">{{ dialogResult }}</p>
    </GalleryBlock>

    <GalleryBlock
      title="插件详情：本机数据"
      note="详情页在“技能”下方新增“本机数据”。“删除数据”“清理数据”“停止”“重试”均可操作，结果按“清理结果”选项模拟。"
    >
      <div class="plugin-data__controls">
        <GalleryRow label="状态">
          <div class="plugin-data__state-row">
            <SegmentedTabs :model-value="detailTab" :tabs="DETAIL_TABS" aria-label="详情页状态" @update:model-value="selectDetailTab" />
            <BaseButton variant="ghost" size="sm" @click="selectDetailTab(detailTab)">重置</BaseButton>
          </div>
        </GalleryRow>
        <GalleryRow label="失败原因">
          <SegmentedTabs
            :model-value="failureReason"
            :tabs="FAILURE_TABS"
            aria-label="失败原因"
            @update:model-value="value => (failureReason = value as CleanupFailureReason)"
          />
        </GalleryRow>
        <GalleryRow label="清理结果">
          <SegmentedTabs
            :model-value="outcome"
            :tabs="OUTCOME_TABS"
            aria-label="清理结果"
            @update:model-value="value => (outcome = value as 'success' | 'fail')"
          />
        </GalleryRow>
      </div>

      <div class="plugin-store-view plugin-data__surface">
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
              <Switch v-if="panelState === 'installed'" :model-value="true" ariaLabel="启用知识库" />
              <div v-else class="plugin-data__install">
                <ActionButtons
                  class="plugin-store-install-actions"
                  :primary-action-text="installText"
                  :primary-button-attributes="{ class: 'plugin-store-install-button' }"
                  :is-primary-action-disabled="installBlocked"
                  :show-secondary-action="false"
                />
                <span v-if="installBlocked" class="plugin-data__install-hint">残留数据清理完成后才能安装</span>
              </div>
            </div>
          </section>

          <section class="plugin-store-detail-section">
            <h2>技能</h2>
            <p class="plugin-data__placeholder">（技能列表，与现有页面相同）</p>
          </section>

          <PluginDataPanel
            :state="panelState"
            :rows="detailRows"
            :records-text="detailTab === 'leftover' ? undefined : KNOWLEDGE_RECORDS_TEXT"
            :cleaned-bytes="cleanedBytes"
            :remaining-bytes="remainingBytes"
            :failure-reason="failureReason"
            :attempts="attempts"
            :last-attempt-text="lastAttemptText"
            @delete="requestDelete"
            @stop="stopCleaning"
            @retry="retry"
            @reveal="reveal"
          />

          <section class="plugin-store-detail-footer">
            <div class="plugin-store-detail-facts">
              <div class="plugin-store-detail-fact"><span>版本</span><strong>0.1.0</strong></div>
              <div class="plugin-store-detail-fact"><span>开发者</span><strong>Linnya</strong></div>
              <div class="plugin-store-detail-fact"><span>大小</span><strong>17 MB</strong></div>
            </div>
            <div v-if="panelState === 'installed'" class="plugin-store-detail-danger-zone">
              <ActionButtons
                :primary-button-attributes="{ class: 'plugin-store-uninstall-button' }"
                primary-variant="danger"
                :show-secondary-action="false"
                @primary-click="openUninstall('knowledge')"
              >
                <template #primary-content>
                  <DeleteIcon class="plugin-store-uninstall-icon" />
                  <span>卸载</span>
                </template>
              </ActionButtons>
            </div>
          </section>
        </section>
      </div>
      <p v-if="notice" class="plugin-data__notice" role="status">{{ notice }}</p>
    </GalleryBlock>

    <GalleryBlock title="提示文案" note="操作完成后在右下角显示，数秒后自动消失。">
      <ul class="plugin-data__copy-list">
        <li>知识库已卸载，本机保留数据 {{ formatBytes(KNOWLEDGE_TOTAL) }}</li>
        <li>知识库已卸载，已释放 {{ formatBytes(KNOWLEDGE_TOTAL) }}</li>
        <li>知识库数据已删除，已释放 {{ formatBytes(KNOWLEDGE_TOTAL) }}</li>
        <li>数据清理未完成，残留 340 MB。可在插件详情页重试。</li>
        <li>残留数据已清理，已释放 340 MB</li>
      </ul>
    </GalleryBlock>

    <!-- 知识库卸载：带“同时删除数据”的选择 -->
    <Modal
      :is-visible="openDialog === 'knowledge' || openDialog === 'knowledge-busy'"
      title="卸载“知识库”"
      width="480px"
      min-height="auto"
      layer="alert"
      @close="closeDialog"
    >
      <div class="alert-dialog-content">
        <div class="alert-dialog-copy plugin-data__dialog-copy">
          <div class="alert-dialog-message">{{ UNINSTALL_MESSAGE }}</div>
          <p v-if="openDialog === 'knowledge-busy'" class="plugin-data__dialog-note">
            当前有 2 份资料正在导入。卸载将取消导入，已导入的内容会保留。
          </p>
          <CustomCheckbox v-model="deleteDataChecked">
            同时删除知识库数据（{{ formatBytes(KNOWLEDGE_TOTAL) }}）
          </CustomCheckbox>
          <div v-if="deleteDataChecked" class="plugin-data__dialog-detail">
            <dl class="plugin-data__dialog-rows">
              <div v-for="row in KNOWLEDGE_DATA_ROWS" :key="row.id" class="plugin-data__dialog-row">
                <dt>{{ row.label }}</dt>
                <dd>{{ formatBytes(row.bytes) }}</dd>
              </div>
            </dl>
            <p class="plugin-data__dialog-records">包括 {{ KNOWLEDGE_RECORDS_TEXT }}及其与项目的关联。</p>
            <p class="alert-dialog-risk-message">{{ DELETE_RISK }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="alert-dialog-footer">
          <ActionButtons
            secondary-action-text="取消"
            :primary-action-text="deleteDataChecked ? '卸载并删除' : '卸载'"
            :primary-variant="deleteDataChecked ? 'danger' : 'default'"
            @secondary-click="closeDialog"
            @primary-click="confirmKnowledgeUninstall"
          />
        </div>
      </template>
    </Modal>

    <AlertDialog
      :visible="openDialog === 'slides'"
      title="卸载“Slides”"
      message="卸载后，Slides 的页面、工具和技能将被移除。已有演示文稿会保留，重新安装后可继续编辑。"
      is-confirmation
      confirm-text="卸载"
      cancel-text="取消"
      @confirm="closeDialog"
      @cancel="closeDialog"
      @close="closeDialog"
    />

    <AlertDialog
      :visible="openDialog === 'blocked'"
      title="暂时无法卸载"
      message="知识库正在执行检索，请在检索完成后再卸载。"
      confirm-text="确定"
      @confirm="closeDialog"
      @close="closeDialog"
    />

    <AlertDialog
      :visible="deleteConfirmVisible"
      :title="detailTab === 'leftover' ? '清理遗留数据' : '删除知识库数据'"
      :message="detailTab === 'leftover' ? '以下数据由早期版本创建，不含用户资料。' : '知识库已卸载，以下为卸载时保留的数据。'"
      :sections="deleteConfirmSections"
      :risk-message="detailTab === 'leftover' ? '' : DELETE_RISK"
      is-confirmation
      is-dangerous-action
      :confirm-text="detailTab === 'leftover' ? '清理' : '删除'"
      cancel-text="取消"
      @confirm="confirmDelete"
      @cancel="deleteConfirmVisible = false"
      @close="deleteConfirmVisible = false"
    />
  </div>
</template>

<style scoped>
.plugin-data {
  display: grid;
  gap: var(--space-8);
}

/* 只借 plugin-store-view 的配色和字号，不要它的整页最小高度。 */
.plugin-data__surface {
  min-height: 0;
  max-width: 760px;
  padding: var(--space-5) var(--space-6);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.plugin-data__cards {
  display: grid;
  gap: var(--space-1);
}

.plugin-data__card-row {
  display: grid;
  grid-template-columns: 8.5em minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.plugin-data__caption,
.plugin-data__placeholder,
.plugin-data__install-hint {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}

.plugin-data__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.plugin-data__controls {
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.plugin-data__state-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.plugin-data__install {
  display: grid;
  justify-items: end;
  gap: var(--space-1);
}

.plugin-data__notice {
  margin: var(--space-3) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
}

.plugin-data__copy-list {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-prose);
}

/* 数据残留：只把状态文字换成警示色，底色沿用未安装的灰。 */
:deep(.plugin-store-state-chip.is-attention) {
  color: var(--color-warning-text);
  background-color: var(--color-bg-disabled);
}

.plugin-data__dialog-copy {
  gap: var(--space-3);
}

.plugin-data__dialog-note {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-normal);
}

.plugin-data__dialog-detail {
  display: grid;
  gap: var(--space-2);
  padding-left: calc(16px + var(--space-2)); /* scale-exempt: 与复选框文字左缘对齐 */
}

.plugin-data__dialog-rows {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.plugin-data__dialog-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.plugin-data__dialog-row dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.plugin-data__dialog-records {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}
</style>
