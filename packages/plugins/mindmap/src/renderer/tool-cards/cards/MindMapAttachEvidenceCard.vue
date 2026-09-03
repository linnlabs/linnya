<template>
  <div class="mindmap-attach-evidence-card">
    <!-- 状态：执行中 -->
    <div v-if="isExecuting" class="loading-state">
      <div class="loading-spinner"></div>
      <span>正在挂载证据到 MindMap...</span>
    </div>

    <!-- 状态：成功 -->
    <div v-else-if="presentation.status === 'success'" class="content-container">
      <div class="content-card">
        <div class="rows">
          <!-- 中文说明：
            - 去掉“结果/成功”这些对用户无意义的统计；
            - 结构对齐「更新标签」：左右两列、每条两行（节点/变更）；
            - 节点引用可点击，并展示节点名（topic）一行省略。
          -->
          <div v-if="items.length > 0" class="change-list">
            <div
              v-for="(it, idx) in items"
              :key="it.evidenceId || it.nodeRef || it.nodeId || idx"
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
                  <span class="change-text">挂载证据</span>
                  <span v-if="it.status === 'failed' && it.message" class="muted" :title="it.message">
                    （失败：{{ it.message }}）
                  </span>
                </span>
              </div>
            </div>
          </div>
          <div v-else class="empty-state muted">无操作</div>

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
      <div class="error-text">MindMap 挂证据失败</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { WorkspaceRefLink } from '@plugin/renderer/referenceLinkUi';
import { normalizeRef } from '@plugin/renderer/refId';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { MindmapMutationPresentationData } from '../definitions/mindmapToolPresentation';

/**
 * MindMapAttachEvidenceCard
 *
 * 中文说明：
 * - 该卡片用于展示 `mindmap_attach_evidence` 的结构化结果摘要；
 * - 只读取后端明确返回的字段（attachedCount/failedCount/results/warnings）；
 * - 默认只展示前若干条明细，避免批量挂载时刷屏。
 */

const props = defineProps<{
  presentation: ToolCardPresentation<MindmapMutationPresentationData>;
  /** 透传字段：避免 Vue “未知 prop” 警告 */
  messageId?: string;
}>();

const isExecuting = computed(() => props.presentation.status === 'loading');
const documentId = computed(() => props.presentation.data.documentId);

function toMindMapRefWithDocument(refLike: string): string {
  const ref = normalizeRef(String(refLike ?? '').trim());
  const docId = documentId.value;
  if (!docId) return ref;
  return `${ref}@mindmap:${docId}`;
}

const items = computed(() => (
  props.presentation.data.kind === 'attach-evidence' ? props.presentation.data.items : []
));

const warnings = computed(() => (
  props.presentation.data.kind === 'attach-evidence' ? props.presentation.data.warnings : []
));
const warningsPreview = computed(() => warnings.value.slice(0, 3));
</script>
