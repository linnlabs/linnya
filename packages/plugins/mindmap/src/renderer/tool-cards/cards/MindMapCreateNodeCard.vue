<template>
  <div class="mindmap-create-node-card">
    <!-- 状态：执行中 -->
    <div v-if="isExecuting" class="loading-state">
      <div class="loading-spinner"></div>
      <span>正在创建 MindMap 节点...</span>
    </div>

    <!-- 状态：成功 -->
    <div v-else-if="presentation.status === 'success'" class="content-container">
      <div class="content-card">
        <div class="rows">
          <div class="row">
            <span class="label">新增</span>
            <span class="value">{{ createdText }}</span>
          </div>

          <div v-if="createdNodes.length > 0" class="row">
            <span class="label">内容</span>
            <span class="value">
              <!-- 中文说明：节点内容可能很多条，按竖向列表展示 -->
              <div class="node-list">
                <div
                  v-for="(n, idx) in createdNodes"
                  :key="n.nodeRef || n.nodeId || idx"
                  class="node-item"
                >
                  <div class="node-item__meta">
                    <!-- 中文说明：这里的 nodeRef/#ref 也应可点击跳转（与对话侧一致） -->
                    <WorkspaceRefLink
                      v-if="n.nodeRef"
                      class="node-item__ref"
                      :rawRef="toMindMapRefWithDocument(n.nodeRef)"
                    />
                    <span v-else-if="n.nodeId" class="node-item__ref mono" :title="n.nodeId">
                      {{ n.nodeId }}
                    </span>
                  </div>
                  <div class="node-item__topic" :title="n.topic || ''">
                    <template v-for="(seg, sIdx) in parseTopicSegments(n.topic ?? '')" :key="`${idx}-${sIdx}`">
                      <template v-if="seg.type === 'text'">{{ seg.text }}</template>
                      <WorkspaceRefLink v-else :rawRef="seg.rawRef" />
                    </template>
                  </div>
                </div>
              </div>
            </span>
          </div>

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
      <div class="error-text">MindMap 创建节点失败</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { WorkspaceRefLink } from '@plugin/renderer/referenceLinkUi';
import { isValidRef, normalizeRef } from '@plugin/renderer/refId';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { MindmapMutationPresentationData } from '../definitions/mindmapToolPresentation';

/**
 * MindMapCreateNodeCard
 *
 * 中文说明：
 * - 展示 `mindmap_create_node` 的结构化结果摘要；
 * - 严格基于工具返回字段读取，不做推测式修复；
 * - 默认只展示部分节点/标题，避免批量创建刷屏。
 */

const props = defineProps<{
  presentation: ToolCardPresentation<MindmapMutationPresentationData>;
  /** 透传字段：避免 Vue “未知 prop” 警告 */
  messageId?: string;
}>();

const isExecuting = computed(() => props.presentation.status === 'loading');
const documentId = computed(() => props.presentation.data.documentId);
const createdNodes = computed(() => (
  props.presentation.data.kind === 'create-node' ? props.presentation.data.items : []
));

const createdCount = computed(() => (
  props.presentation.data.kind === 'create-node' ? props.presentation.data.createdCount : 0
));
const createdText = computed(() => {
  const n = createdCount.value;
  if (typeof n !== 'number' || n <= 0) return '0 个';
  return `${n} 个`;
});

const warnings = computed(() => (
  props.presentation.data.kind === 'create-node' ? props.presentation.data.warnings : []
));
const warningsPreview = computed(() => warnings.value.slice(0, 3));

type TopicSegment = { type: 'text'; text: string } | { type: 'ref'; rawRef: string };

const DEFAULT_REF_LEN = 6;

function toMindMapRefWithDocument(refLike: string): string {
  const ref = normalizeRef(String(refLike ?? '').trim());
  const docId = documentId.value;
  if (!docId) return ref;
  return `${ref}@mindmap:${docId}`;
}

/**
 * 将节点 topic 拆为“纯文本 + #ref 链接”的片段列表。
 *
 * 中文说明：
 * - 只解析明确的 `#xxxxxx`（6 位 base58）模式；
 * - 如果引用未带 @documentId，则默认绑定到当前 MindMap 文档：`#ref@mindmap:<documentId>`；
 * - 这样点击后无需推断候选文档，交互更稳定。
 */
function parseTopicSegments(topic: string): TopicSegment[] {
  const text = topic ?? '';
  if (!text) return [{ type: 'text', text: '' }];

  const result: TopicSegment[] = [];

  // 中文说明：为避免 regex 对边界字符过于敏感，这里用“扫描 + isValidRef 校验”的方式解析 #ref。
  let i = 0;
  let last = 0;
  while (i < text.length) {
    if (text[i] !== '#') {
      i += 1;
      continue;
    }

    const candidate = text.slice(i, i + 1 + DEFAULT_REF_LEN);
    if (!isValidRef(normalizeRef(candidate))) {
      i += 1;
      continue;
    }

    // 命中一个 ref：先 push 前面的纯文本
    if (i > last) {
      result.push({ type: 'text', text: text.slice(last, i) });
    }

    // 支持显式 @... 后缀：#ref@xxx（直到空白结束）
    let end = i + 1 + DEFAULT_REF_LEN;
    if (text[end] === '@') {
      let j = end + 1;
      while (j < text.length && !/\s/.test(text[j])) j += 1;
      end = j;
    }

    const rawRef = (() => {
      const rawToken = text.slice(i, end); // 可能包含 @suffix
      const atIdx = rawToken.indexOf('@');
      if (atIdx !== -1) return rawToken;
      // 未显式带 doc：默认绑定当前 mindmap 文档，确保点击可直达且不歧义
      return toMindMapRefWithDocument(rawToken);
    })();

    result.push({ type: 'ref', rawRef });
    last = end;
    i = end;
  }

  if (last < text.length) result.push({ type: 'text', text: text.slice(last) });

  return result.length > 0 ? result : [{ type: 'text', text }];
}
</script>
