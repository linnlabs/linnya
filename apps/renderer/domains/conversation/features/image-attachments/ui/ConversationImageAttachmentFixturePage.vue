<template>
  <main class="conversation-image-fixture">
    <header class="conversation-image-fixture__header">
      <div>
        <p class="conversation-image-fixture__eyebrow">
          Phase 4.10
        </p>
        <h1>图片附件全链路验收</h1>
      </div>
      <span class="conversation-image-fixture__status">
        {{ fixture.drafts.items.length }} 个草稿
      </span>
    </header>

    <section
      class="conversation-image-fixture__section"
      aria-labelledby="fixture-entry-title"
    >
      <div class="conversation-image-fixture__section-heading">
        <div>
          <h2 id="fixture-entry-title">
            输入与暂存
          </h2>
          <p>选择、拖放和粘贴使用同一条生产暂存链路</p>
        </div>
        <button
          type="button"
          class="conversation-image-fixture__text-button"
          :disabled="fixture.drafts.items.length === 0"
          @click="fixture.clear"
        >
          清空
        </button>
      </div>

      <div
        class="conversation-image-fixture__drop-zone"
        data-testid="image-drop-zone"
        tabindex="0"
        @dragover.prevent
        @drop="handleDrop"
        @paste="handlePaste"
      >
        <ConversationImageAttachmentPicker
          :disabled="false"
          :title="conversationMessage('conversation.input.image.add')"
          @files-selected="files => fixture.stageFiles({ source: 'picker', files })"
        />
        <div>
          <strong>{{ conversationMessage('conversation.input.image.drop') }}</strong>
          <span>也可以聚焦此区域后粘贴图片</span>
        </div>
      </div>

      <ConversationImageAttachmentDraftStrip
        :items="fixture.drafts.items"
        :message="entryMessage"
        @remove="fixture.remove"
        @retry="fixture.retry"
      />
      <p
        class="conversation-image-fixture__entry-state"
        aria-live="polite"
      >
        最近入口：{{ fixture.lastEntrySource ?? '尚未添加' }}
      </p>
    </section>

    <section
      class="conversation-image-fixture__section"
      aria-labelledby="fixture-history-title"
    >
      <div class="conversation-image-fixture__section-heading">
        <div>
          <h2 id="fixture-history-title">
            历史消息与预览
          </h2>
          <p>生产 preview adapter 加载受管图片，点击图片打开专用图片预览</p>
        </div>
      </div>
      <div class="conversation-image-fixture__message">
        <ConversationImageAttachmentGallery :attachments="fixture.durableAttachments" />
        <p>请比较这两张图片的顺序，然后打开任意一张查看完整预览。</p>
      </div>
    </section>

    <section
      class="conversation-image-fixture__section"
      aria-labelledby="fixture-error-title"
    >
      <div class="conversation-image-fixture__section-heading">
        <div>
          <h2 id="fixture-error-title">
            稳定错误占位
          </h2>
          <p>缺失资源与完整性校验失败不会泄漏本地路径或原始响应</p>
        </div>
      </div>
      <ConversationImageAttachmentGallery :attachments="fixture.errorAttachments" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ConversationImageAttachmentDraftStrip from './ConversationImageAttachmentDraftStrip.vue';
import ConversationImageAttachmentGallery from './ConversationImageAttachmentGallery.vue';
import ConversationImageAttachmentPicker from './ConversationImageAttachmentPicker.vue';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { useConversationImageAttachmentFixture } from '../orchestration/useConversationImageAttachmentFixture';

const fixture = useConversationImageAttachmentFixture();
const { conversationMessage } = useConversationLocalization();
const entryMessage = computed(() => {
  const key = fixture.errorMessageKey();
  return key ? conversationMessage(key) : '';
});

function handleDrop(event: DragEvent): void {
  const handled = fixture.stageFiles({
    source: 'drop',
    files: Array.from(event.dataTransfer?.files ?? []),
  });
  if (handled) event.preventDefault();
}

function handlePaste(event: ClipboardEvent): void {
  const handled = fixture.stageFiles({
    source: 'paste',
    files: Array.from(event.clipboardData?.files ?? []),
    hasPlainText: (event.clipboardData?.getData('text/plain').length ?? 0) > 0,
  });
  if (handled) event.preventDefault();
}
</script>
