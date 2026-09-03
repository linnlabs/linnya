<template>
  <div
    class="knowledge-search-card kb-search-card"
    :class="{
      'knowledge-search-card--empty': !hasVisibleContent,
      'kb-search-card--empty': !hasVisibleContent,
    }"
  >
    <div v-if="status === 'success'" class="content-container">
      <div class="header-meta">
        <div class="subtitle-row">
          <span class="subtitle">{{ scopeLabel }}</span>
          <span v-if="files.length > 0" class="subtitle">
            {{
              conversationMessage('conversation.tool.knowledgeSearch.relatedDocuments', {
                count: files.length,
              })
            }}
          </span>
          <span v-else-if="snapshotPointer" class="subtitle">
            {{
              conversationMessage('conversation.tool.knowledgeSearch.snapshotPointerWithCount', {
                count: snapshotPointer.count,
              })
            }}
          </span>
          <span v-else class="subtitle">
            {{ conversationMessage('conversation.tool.knowledgeSearch.empty') }}
          </span>
        </div>
        <div v-if="snapshotPointer && files.length === 0" class="subtitle-row">
          <button
            class="kb-load-btn"
            :disabled="snapshotState.kind === 'loading'"
            @click="loadSnapshot"
          >
            {{
              snapshotState.kind === 'loading'
                ? conversationMessage('conversation.tool.knowledgeSearch.loadLoading')
                : conversationMessage('conversation.tool.knowledgeSearch.loadDetails')
            }}
          </button>
          <button
            class="kb-download-link"
            :disabled="isDownloadingSnapshot"
            @click="downloadSnapshot"
          >
            {{
              isDownloadingSnapshot
                ? conversationMessage('conversation.tool.knowledgeSearch.exportLoading')
                : conversationMessage('conversation.tool.knowledgeSearch.exportJson')
            }}
          </button>
          <span v-if="snapshotState.kind === 'error'" class="kb-load-error">
            {{ conversationMessage('conversation.tool.knowledgeSearch.loadFailedGeneric') }}
          </span>
        </div>
      </div>

      <div v-if="files.length > 0" class="file-list">
        <div v-for="file in files" :key="file.docId" class="file-card">
          <div class="file-header">
            <div class="file-header-left">
              <div class="file-icon-wrapper">
                <DocumentIcon class="file-icon" />
              </div>
              <span class="file-name" :title="file.docName">{{ file.docName }}</span>
            </div>
          </div>
          <div class="file-body">
            <div v-for="match in file.matches" :key="match.id" class="match-row">
              <div class="match-bar-wrapper"><div class="match-bar"></div></div>
              <div class="match-snippet" :title="match.snippet">{{ match.snippet }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-icon">!</div>
      <div class="error-text">
        {{ conversationMessage('conversation.tool.knowledgeSearch.error') }}
      </div>
    </div>

    <SubrunTracePanel
      :status="status"
      :enabled="requestedDeepSearch && status !== 'error'"
      :subrunTrace="subrunTrace"
      :subrunTraceVersion="subrunTraceVersion"
      :titleExecuting="conversationMessage('conversation.tool.knowledgeSearch.traceExecuting')"
      :titleCompleted="conversationMessage('conversation.tool.knowledgeSearch.traceCompleted')"
      :lazySource="deepSearchLazySource"
      disclosure-mode="collapsible"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import {
  hasSubrunTraceBucket,
  type HistoricalSubrunTraceLazySource,
  SubrunTracePanel,
} from '../../../features/subrun-trace';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type {
  HistoricalKnowledgeSearchSnapshotPointerPresentation,
  KnowledgeSearchPresentationData,
  KnowledgeSearchResultsPresentation,
} from './definitions/knowledgeSearchPresentation';
import { useHistoricalKnowledgeSearchSnapshot } from './orchestration/useHistoricalKnowledgeSearchSnapshot';

const props = defineProps<{
  presentation: ToolCardPresentation<KnowledgeSearchPresentationData>;
  messageId?: string;
  conversationId?: string;
  subrunTrace?: unknown;
  subrunTraceVersion?: number;
  lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
}>();

const { conversationMessage } = useConversationLocalization();
const status = computed(() => props.presentation.status);
const sourceData = computed(() => props.presentation.data);
const snapshotPointer = computed<HistoricalKnowledgeSearchSnapshotPointerPresentation | null>(() =>
  sourceData.value.kind === 'historical-snapshot-pointer' ? sourceData.value : null
);
const snapshot = useHistoricalKnowledgeSearchSnapshot({
  source: () => snapshotPointer.value,
  conversationId: () => props.conversationId ?? null,
});
const snapshotState = snapshot.state;
const isDownloadingSnapshot = snapshot.isDownloading;
const loadSnapshot = snapshot.load;
const downloadSnapshot = snapshot.download;

const resultData = computed<KnowledgeSearchResultsPresentation | null>(() => {
  if (snapshotState.value.kind === 'ready') return snapshotState.value.presentation;
  return sourceData.value.kind === 'results' ? sourceData.value : null;
});
const requestedDeepSearch = computed(() => sourceData.value.requestedDeepSearch === true);
const files = computed(() => resultData.value?.files ?? []);
const subrunTraceVersion = computed(() => props.subrunTraceVersion ?? 0);
const deepSearchLazySource = computed(() => {
  const source = props.lazySubrunTraceSource;
  const data = resultData.value;
  return requestedDeepSearch.value && source && data?.subrunId
    ? { ...source, subrunId: data.subrunId }
    : undefined;
});
const hasDeepSearchTraceData = computed(
  () => hasSubrunTraceBucket(props.subrunTrace) || deepSearchLazySource.value !== undefined
);
const hasVisibleContent = computed(
  () =>
    status.value === 'success' ||
    status.value === 'error' ||
    (requestedDeepSearch.value && hasDeepSearchTraceData.value)
);

const scopeLabel = computed(() => {
  const data = resultData.value;
  const scope =
    data?.searchMode === 'document' && data.docName
      ? conversationMessage('conversation.tool.knowledgeSearch.scopeDocument', {
          docName: data.docName,
        })
      : conversationMessage('conversation.tool.knowledgeSearch.scopeKnowledgeBase');
  const strategy = data?.actualStrategy ?? (requestedDeepSearch.value ? 'deep' : 'shallow');
  const action =
    strategy === 'deep'
      ? conversationMessage('conversation.tool.knowledgeSearch.actionDeepSearch')
      : conversationMessage('conversation.tool.knowledgeSearch.actionSearch');
  return `${scope}${action}`;
});
</script>
