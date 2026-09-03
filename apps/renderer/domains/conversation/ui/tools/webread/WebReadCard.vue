<!--
  @file WebReadCard.vue
  @description 网页正文读取工具卡片组件

  展示 web_read 工具的读取结果：标题（可点击）、域名·字符数·截断提示、snippet。
  正文内容不在卡片中全量展示（由 LLM 输出/引用承载），卡片只做概要。
-->
<template>
  <div class="web-read-card">
    <!-- 加载中 -->
    <div v-if="status === 'loading'" class="wr-state">
      <div class="wr-spinner"></div>
      <span>{{ conversationMessage('conversation.tool.webRead.loading') }}</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="status === 'error'" class="wr-state wr-state--error">
      {{ conversationMessage('conversation.tool.webRead.failed') }}
    </div>

    <!-- 结果 -->
    <div v-else-if="pageInfo" class="wr-content">
      <a
        class="wr-title"
        :href="pageInfo.url"
        target="_blank"
        rel="noopener noreferrer"
        :title="pageInfo.url"
        @click.stop.prevent="handleOpenUrl(pageInfo.url)"
      >{{ pageInfo.title || conversationMessage('conversation.tool.webRead.untitled') }}</a>

      <!-- 元信息行：左侧（域名 · 作者 · 字符数 · 截断）+ 右侧（时间） -->
      <div class="wr-info">
        <div class="wr-info-left">
          <span v-if="pageInfo.url" class="wr-info-seg">{{ extractDomain(pageInfo.url) }}</span>
          <span v-if="pageInfo.author" class="wr-info-seg">{{ pageInfo.author }}</span>
          <span class="wr-info-seg">{{ characterCountText }}</span>
          <span v-if="pageInfo.truncated" class="wr-info-seg wr-info-seg--warn">
            {{ conversationMessage('conversation.tool.webRead.truncated') }}
          </span>
        </div>
        <span v-if="pageInfo.publishedAt" class="wr-info-date">{{ pageInfo.publishedAt }}</span>
      </div>

      <div v-if="pageInfo.snippet" class="wr-snippet">{{ pageInfo.snippet }}</div>
    </div>

    <!-- 空结果 -->
    <div v-else class="wr-state">
      {{ conversationMessage('conversation.tool.webRead.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { openExternalUrl } from '../../../../../shared/utils/openExternalUrl';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { WebReadPresentationData } from './definitions/webReadPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<WebReadPresentationData>;
}>();
const { currentLocale, conversationMessage } = useConversationLocalization();
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

const pageInfo = computed(() => (
  props.presentation.data.kind === 'page' ? props.presentation.data : null
));

const characterCountText = computed(() => {
  const count = pageInfo.value?.charCount ?? 0;
  return conversationMessage('conversation.tool.webRead.characterCount', {
    count: count.toLocaleString(currentLocale.value),
  });
});
</script>
