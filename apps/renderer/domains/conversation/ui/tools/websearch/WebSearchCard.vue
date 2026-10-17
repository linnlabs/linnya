<!--
  @file WebSearchCard.vue
  @description 联网搜索工具卡片组件

  展示 web_search 工具的搜索结果列表。
  每条结果展示：标题（可点击）、域名、snippet 片段。
-->
<template>
  <div class="web-search-card">
    <p
      v-if="resultData?.limited"
      class="ws-state"
    >
      {{ conversationMessage('conversation.tool.webSearch.limit') }}
    </p>
    <!-- 加载中 -->
    <ToolActivityIndicator
      v-if="status === 'loading'"
      :running-label="conversationMessage('conversation.tool.webSearch.loading')"
    />

    <!-- 错误 -->
    <div
      v-else-if="status === 'error'"
      class="ws-state ws-state--error"
    >
      {{ conversationMessage('conversation.tool.webSearch.failed') }}
    </div>

    <!-- 结果列表 -->
    <div
      v-else-if="results.length > 0"
      class="ws-list"
    >
      <div
        v-for="item in results"
        :key="item.id"
        class="ws-item"
      >
        <a
          class="ws-title"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="item.url"
          @click.stop.prevent="handleOpenUrl(item.url)"
        >{{ item.docTitle || conversationMessage('conversation.tool.webSearch.untitled') }}</a>
        <!-- 元信息行：左侧（域名 · 作者） + 右侧（时间） -->
        <div class="ws-meta">
          <div class="ws-meta-left">
            <span
              v-if="item.url"
              class="ws-meta-seg"
            >{{ extractDomain(item.url) }}</span>
          </div>
          <span
            v-if="item.publishedAt"
            class="ws-meta-date"
          >{{ item.publishedAt }}</span>
        </div>
        <div
          v-if="item.snippet"
          class="ws-snippet"
        >
          {{ item.snippet }}
        </div>
        <template v-if="notesByRef.get(item.id)">
          <p>
            {{ captureLabel(notesByRef.get(item.id)?.capture_kind)
            }}<span v-if="notesByRef.get(item.id)?.truncated">
              · {{ conversationMessage('conversation.tool.webSearch.truncated') }}</span>
          </p>
          <p>{{ notesByRef.get(item.id)?.purpose }}</p>
          <p v-if="notesByRef.get(item.id)?.warnings.length">
            {{ conversationMessage('conversation.tool.webSearch.extractionFlags', {flags: notesByRef.get(item.id)?.warnings.join(', ') ?? ''}) }}
          </p>
        </template>
      </div>
    </div>

    <!-- 空结果 -->
    <div
      v-else
      class="ws-state"
    >
      {{ conversationMessage('conversation.tool.webSearch.empty') }}
    </div>
    <section
      v-if="resultData?.materials"
      class="ws-state"
    >
      <p>{{ conversationMessage('conversation.tool.webSearch.materialNotice') }}</p>
      <p v-if="resultData.materials.notes_truncated">
        {{ conversationMessage('conversation.tool.webSearch.notesTruncated') }}
      </p>
      <p>{{ conversationMessage('conversation.tool.webSearch.summary') }} {{ resultData.materials.summary }}</p>
      <p
        v-for="gap in resultData.materials.gaps"
        :key="gap"
      >
        {{ conversationMessage('conversation.tool.webSearch.gap') }} {{ gap }}
      </p>
      <p
        v-for="conflict in resultData.materials.conflicts"
        :key="conflict"
      >
        {{ conversationMessage('conversation.tool.webSearch.conflict') }} {{ conflict }}
      </p>
      <p
        v-for="failure in resultData.materials.failures"
        :key="failure.call_id"
      >
        {{ failure.tool }}: {{ failure.error }}
      </p>
    </section>
    <SubrunTracePanel
      :status="status"
      :enabled="presentation.data.requestedDeepSearch === true && !resultData?.limited"
      :subrun-trace="subrunTrace"
      :subrun-trace-version="subrunTraceVersion ?? 0"
      :lazy-source="deepSearchLazySource"
      :title-executing="conversationMessage('conversation.tool.knowledgeSearch.traceExecuting')"
      :title-completed="conversationMessage('conversation.tool.knowledgeSearch.traceCompleted')"
      disclosure-mode="collapsible"
    />
  </div>
</template>

<script setup lang="ts">
import { ToolActivityIndicator } from '../../../shared/execution-presentation';
import { computed } from 'vue';
import {
  SubrunTracePanel,
  type HistoricalSubrunTraceLazySource,
} from '../../../features/subrun-trace';
import { openExternalUrl } from '../../../../../shared/utils/openExternalUrl';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { WebSearchPresentationData } from './definitions/webSearchPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<WebSearchPresentationData>;
  subrunTrace?: unknown;
  subrunTraceVersion?: number;
  lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
}>();
const { conversationMessage } = useConversationLocalization();
const status = computed(() => props.presentation.status);

/** 从 URL 中提取域名，去掉 www. 前缀 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * 点击标题：使用系统默认浏览器打开网页
 *
 * 中文说明：
 * - 必须 .prevent 默认行为，避免 Electron 内部开窗加载远程页面；
 * - 真实打开由主进程 shell.openExternal 执行（见 openExternalUrl 工具函数）。
 */
function handleOpenUrl(url: string): void {
  void openExternalUrl(url);
}

const resultData = computed(() =>
  props.presentation.data.kind === 'results' ? props.presentation.data : null
);
const deepSearchLazySource = computed(() => {
  const source = props.lazySubrunTraceSource;
  const id = resultData.value?.subrunIds?.[0];
  return source && id ? { ...source, subrunId: id } : source;
});
const notesByRef = computed(
  () => new Map(resultData.value?.materials?.source_notes.map(note => [note.ref, note]) ?? [])
);
function captureLabel(kind: string | undefined): string {
  return conversationMessage(
    kind === 'file_download'
      ? 'conversation.tool.webSearch.fileDownload'
      : kind === 'page_content'
      ? 'conversation.tool.webSearch.pageContent'
      : kind === 'metadata_only'
        ? 'conversation.tool.webSearch.metadataOnly'
        : 'conversation.tool.webSearch.searchSnippet'
  );
}
const results = computed(() =>
  props.presentation.data.kind === 'results' ? props.presentation.data.items : []
);
</script>
