<!--
  @file WebSearchCard.vue
  @description 联网搜索工具卡片组件

  展示 web_search 工具的搜索结果列表。
  每条结果展示：标题（可点击）、域名、snippet 片段。
-->
<template>
  <div class="web-search-card">
    <!-- 加载中 -->
    <div v-if="status === 'loading'" class="ws-state">
      <div class="ws-spinner"></div>
      <span>{{ conversationMessage('conversation.tool.webSearch.loading') }}</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="status === 'error'" class="ws-state ws-state--error">
      {{ conversationMessage('conversation.tool.webSearch.failed') }}
    </div>

    <!-- 结果列表 -->
    <div v-else-if="results.length > 0" class="ws-list">
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
            <span v-if="item.url" class="ws-meta-seg">{{ extractDomain(item.url) }}</span>
          </div>
          <span v-if="item.publishedAt" class="ws-meta-date">{{ item.publishedAt }}</span>
        </div>
        <div v-if="item.snippet" class="ws-snippet">{{ item.snippet }}</div>
      </div>
    </div>

    <!-- 空结果 -->
    <div v-else class="ws-state">
      {{ conversationMessage('conversation.tool.webSearch.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { openExternalUrl } from '../../../../../shared/utils/openExternalUrl';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { WebSearchPresentationData } from './definitions/webSearchPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<WebSearchPresentationData>;
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

const results = computed(() => (
  props.presentation.data.kind === 'results' ? props.presentation.data.items : []
));
</script>
