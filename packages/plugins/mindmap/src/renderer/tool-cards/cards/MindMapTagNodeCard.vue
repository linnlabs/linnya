<template>
  <div class="mindmap-tag-node-card">
    <!-- 状态：执行中 -->
    <div v-if="isExecuting" class="loading-state">
      <div class="loading-spinner"></div>
      <span>正在给 MindMap 节点打标...</span>
    </div>

    <!-- 状态：成功（工具链路 success，但可能“无变更”） -->
    <div v-else-if="presentation.status === 'success'" class="content-container">
      <div class="content-card">
        <!-- 中文说明：
          - 结果区保持“表格”布局（左右两列）；
          - 多节点：用水平分割线分隔；
          - 节点行：节点引用 + topic（一行省略）；
          - 变更行：用与节点一致的 tag chip。
        -->
        <div v-if="items.length <= 0" class="muted empty-state">无变更</div>
        <div v-else class="change-list">
          <div
            v-for="(it, idx) in items"
            :key="it.nodeRef || it.nodeId || idx"
            class="change-item"
            :class="{ 'change-item--divided': idx > 0 }"
          >
            <div class="row">
              <span class="label">节点</span>
              <span class="value">
                <span class="node-line">
                  <WorkspaceRefLink
                    v-if="it.nodeRef"
                    :rawRef="toMindMapRefWithDocument(it.nodeRef)"
                  />
                  <span v-else class="mono">{{ it.nodeId || '-' }}</span>
                  <span v-if="it.topic" class="node-topic" :title="it.topic">{{ it.topic }}</span>
                </span>
              </span>
            </div>

            <div class="row">
              <span class="label">变更</span>
              <span class="value">
                <span class="change-tags">
                  <TagChip
                    v-for="(t, tIdx) in buildTagChips(it.updates)"
                    :key="`${idx}-${tIdx}-${t.label}`"
                    class="mm-tagging-chip"
                    :class="t.className ? [`mm-tagging-chip--${t.className}`] : []"
                    :label="t.label"
                    :title="t.tooltip ?? t.label"
                    :background-color="t.colors?.backgroundColor"
                    :text-color="t.colors?.textColor"
                    :border-color="t.colors?.borderColor"
                  >
                    <template v-if="t.showStatusDot" #icon>
                      <span class="mm-tagging-status-dot" aria-hidden="true" />
                    </template>
                  </TagChip>
                  <span v-if="buildTagChips(it.updates).length === 0" class="muted">无变更</span>
                </span>
              </span>
            </div>
          </div>
        </div>
        <div class="rows">
          <div v-if="warnings.length > 0" class="row warnings">
            <span class="label">警告</span>
            <span class="value">
              <ul class="warning-list">
                <li v-for="(w, idx) in warningsPreview" :key="`${idx}-${w}`">{{ w }}</li>
              </ul>
              <div v-if="warnings.length > warningsPreview.length" class="muted">
                还有 {{ warnings.length - warningsPreview.length }} 条警告未展示
              </div>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 状态：错误 -->
    <div v-else-if="presentation.status === 'error'" class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">MindMap 打标失败</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { TagChip } from '@linnya/renderer-ui';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import { WorkspaceRefLink } from '@plugin/renderer/referenceLinkUi';
import { normalizeRef } from '@plugin/renderer/refId';
import {
  CONFIDENCE_COLORS,
  KIND_COLORS,
  STATUS_COLORS,
  getTaggingKindDisplayConfig,
  useMindMapTaggingStore,
  type TaggingChipColors,
} from '../../features/tagging';
import type {
  MindmapMutationPresentationData,
  MindmapTagNodeUpdatePresentation,
} from '../definitions/mindmapToolPresentation';

/**
 * MindMapTagNodeCard
 *
 * 中文说明：
 * - 该卡片只负责“高信号摘要”，避免 raw_text 把整段 JSON 直接铺出来；
 * - 严格基于工具返回的结构化字段读取，不做推测式修复；
 * - ToolCallsMessage 只传入 owner projector 已接纳的 presentation。
 */

const props = defineProps<{
  presentation: ToolCardPresentation<MindmapMutationPresentationData>;
  /** 透传字段：避免 Vue “未知 prop” 警告 */
  messageId?: string;
}>();

const isExecuting = computed(() => props.presentation.status === 'loading');
const documentId = computed(() => props.presentation.data.documentId);

const taggingStore = useMindMapTaggingStore();

function toMindMapRefWithDocument(refLike: string): string {
  const ref = normalizeRef(String(refLike ?? '').trim());
  const docId = documentId.value;
  if (!docId) return ref;
  return `${ref}@mindmap:${docId}`;
}

type ChipModel = {
  label: string;
  className?: string;
  tooltip?: string;
  colors?: TaggingChipColors;
  showStatusDot?: boolean;
};

function buildTagChips(updates: MindmapTagNodeUpdatePresentation | undefined): ChipModel[] {
  if (!updates) return [];

  const chips: ChipModel[] = [];

  // kind
  const kindRaw = typeof updates.kind === 'string' ? updates.kind : undefined;
  if (kindRaw) {
    const cfg = getTaggingKindDisplayConfig(kindRaw);
    chips.push({
      label: cfg.label,
      className: cfg.className,
      tooltip: cfg.tooltip,
      colors: KIND_COLORS[cfg.className] ?? KIND_COLORS['mm-kind-badge--unknown'],
    });
  }

  // status
  const statusRaw = typeof updates.status === 'string' ? updates.status : undefined;
  if (statusRaw) {
    const cfg = taggingStore.getStatusDisplayConfig(statusRaw);
    if (cfg) {
      chips.push({
        label: cfg.label,
        className: cfg.className,
        tooltip: cfg.label,
        colors: STATUS_COLORS[cfg.className] ?? STATUS_COLORS.unknown,
        showStatusDot: true,
      });
    }
  }

  // confidence
  const confRaw = updates.confidence;
  if (confRaw !== undefined) {
    const cfg = taggingStore.getConfidenceDisplayConfig(confRaw);
    if (cfg) {
      chips.push({
        label: cfg.label,
        className: cfg.className,
        tooltip: cfg.label,
        colors: CONFIDENCE_COLORS[cfg.className] ?? CONFIDENCE_COLORS.unknown,
      });
    }
  }

  return chips;
}

const items = computed(() => (
  props.presentation.data.kind === 'tag-node' ? props.presentation.data.items : []
));
const warnings = computed(() => (
  props.presentation.data.kind === 'tag-node' ? props.presentation.data.warnings : []
));
const warningsPreview = computed(() => warnings.value.slice(0, 3));
</script>
