<script setup lang="ts">
import { BaseButton } from '@linnya/renderer-ui';
import {
  CLEANUP_FAILURE_COPY,
  canRevealCleanupBlocker,
  formatBytes,
  sumBytes,
  type CleanupFailureReason,
  type PluginDataRow,
} from './pluginDataDemo.ts';

/**
 * 插件详情页的“本机数据”区（预览原型）。
 * 只用文字层级、留白和对齐表达状态，不加底色卡片或色条；警示只改标题文字颜色。
 */
export type PluginDataPanelState =
  | 'installed'
  | 'uninstalled'
  | 'uninstalled-empty'
  | 'leftover'
  | 'cleaning'
  | 'incomplete'
  | 'retrying';

const props = defineProps<{
  readonly state: PluginDataPanelState;
  readonly rows: readonly PluginDataRow[];
  readonly recordsText?: string;
  readonly cleanedBytes?: number;
  readonly remainingBytes?: number;
  readonly failureReason?: CleanupFailureReason;
  readonly attempts?: number;
  readonly lastAttemptText?: string;
}>();

const emit = defineEmits<{
  delete: [];
  stop: [];
  retry: [];
  reveal: [];
}>();

function total(): number {
  return sumBytes(props.rows);
}
</script>

<template>
  <section class="plugin-store-detail-section plugin-data-panel" aria-label="本机数据">
    <div class="plugin-data-panel__header">
      <h2>本机数据</h2>
      <span v-if="state !== 'uninstalled-empty' && state !== 'cleaning' && state !== 'incomplete' && state !== 'retrying'" class="plugin-data-panel__total">
        共 {{ formatBytes(total()) }}
      </span>
    </div>

    <!-- 有数据：按类别列出实际占用 -->
    <template v-if="state === 'installed' || state === 'uninstalled' || state === 'leftover'">
      <p v-if="state === 'leftover'" class="plugin-data-panel__lead">
        没有你的资料。以前的版本留下了空的检索索引和日志。
      </p>
      <dl class="plugin-data-panel__rows">
        <div v-for="row in rows" :key="row.id" class="plugin-data-panel__row">
          <dt>{{ row.label }}</dt>
          <dd class="plugin-data-panel__size">{{ formatBytes(row.bytes) }}</dd>
          <dd class="plugin-data-panel__note">{{ row.note }}</dd>
        </div>
      </dl>
      <p v-if="recordsText" class="plugin-data-panel__records">{{ recordsText }}</p>
      <p v-if="state === 'installed'" class="plugin-data-panel__hint">卸载时可以选择是否一起删除这些数据。</p>
      <div v-else class="plugin-data-panel__actions">
        <button type="button" class="plugin-data-panel__danger" @click="emit('delete')">
          {{ state === 'leftover' ? '清理这些数据' : '删除数据' }}
        </button>
      </div>
    </template>

    <p v-else-if="state === 'uninstalled-empty'" class="plugin-data-panel__lead">本机没有它的数据了。</p>

    <!-- 删除中：进度、可停止 -->
    <template v-else-if="state === 'cleaning'">
      <div class="plugin-data-panel__progress-line">
        <span>正在删除，已删除 {{ formatBytes(cleanedBytes ?? 0) }}，还剩 {{ formatBytes(remainingBytes ?? 0) }}</span>
        <BaseButton variant="secondary" size="sm" @click="emit('stop')">停止</BaseButton>
      </div>
      <div class="plugin-data-panel__progress" role="progressbar" :aria-valuenow="Math.round(((cleanedBytes ?? 0) / ((cleanedBytes ?? 0) + (remainingBytes ?? 1))) * 100)" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${((cleanedBytes ?? 0) / ((cleanedBytes ?? 0) + (remainingBytes ?? 1))) * 100}%` }" />
      </div>
      <p class="plugin-data-panel__hint">停止后，已经删除的部分无法恢复；剩下的数据可以之后再删。</p>
    </template>

    <!-- 没删完：剩余占用、可读原因、重试 -->
    <template v-else>
      <p class="plugin-data-panel__attention">还剩 {{ formatBytes(remainingBytes ?? 0) }} 没有删除</p>
      <p class="plugin-data-panel__reason">
        {{ state === 'retrying' ? '正在重新删除剩下的数据…' : CLEANUP_FAILURE_COPY[failureReason ?? 'busy'] }}
      </p>
      <p v-if="state !== 'retrying' && lastAttemptText" class="plugin-data-panel__meta">
        {{ lastAttemptText }}<template v-if="(attempts ?? 1) > 1"> · 已尝试 {{ attempts }} 次</template>
      </p>
      <div class="plugin-data-panel__actions is-start">
        <BaseButton variant="secondary" size="sm" :disabled="state === 'retrying'" @click="emit('retry')">
          {{ state === 'retrying' ? '正在重试…' : '重试' }}
        </BaseButton>
        <BaseButton
          v-if="state !== 'retrying' && canRevealCleanupBlocker(failureReason ?? 'busy')"
          variant="ghost"
          size="sm"
          @click="emit('reveal')"
        >
          显示文件位置
        </BaseButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.plugin-data-panel__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}

.plugin-data-panel__total {
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  font-variant-numeric: tabular-nums;
}

.plugin-data-panel__lead,
.plugin-data-panel__reason {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.plugin-data-panel__rows {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}

.plugin-data-panel__row {
  display: grid;
  grid-template-columns: 9em 5.5em minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-4);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.plugin-data-panel__row dt {
  color: var(--color-text-primary);
}

.plugin-data-panel__row dd {
  margin: 0;
}

.plugin-data-panel__size {
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.plugin-data-panel__note,
.plugin-data-panel__records,
.plugin-data-panel__hint,
.plugin-data-panel__meta {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}

.plugin-data-panel__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.plugin-data-panel__actions.is-start {
  justify-content: flex-start;
}

/* 与详情页现有“卸载”按钮同一套危险文字按钮。 */
.plugin-data-panel__danger {
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-error-text);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-body);
  cursor: pointer;
}

.plugin-data-panel__danger:hover {
  background-color: var(--color-error-bg-subtle);
}

.plugin-data-panel__progress-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
  font-variant-numeric: tabular-nums;
}

.plugin-data-panel__progress {
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background-color: var(--color-bg-subtle);
}

.plugin-data-panel__progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background-color: var(--color-accent);
  transition: width var(--duration-medium) var(--ease-standard);
}

.plugin-data-panel__attention {
  margin: 0;
  color: var(--color-warning-text);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}
</style>
