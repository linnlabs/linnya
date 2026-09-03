<template>
  <main class="visual-row-fixture-page">
    <header class="visual-row-fixture-toolbar">
      <div>
        <h1>Visual-row integration fixture</h1>
        <p>B1 projection, existing message components, and isolated TanStack canvas</p>
      </div>
      <div class="visual-row-fixture-toolbar__actions">
        <button
          type="button"
          :disabled="gateReport.status === 'running'"
          @click="runGates"
        >
          Run B2
        </button>
      </div>
    </header>

    <section class="visual-row-fixture-report">
      <strong>B2: {{ gateReport.status }}</strong>
      <span
        v-for="result in gateReport.results"
        :key="result.label"
        :class="result.passed ? 'status-pass' : 'status-fail'"
      >
        {{ result.label }}: {{ result.detail }}
      </span>
      <span>{{ rows.length }} rows / {{ measurementSnapshot }} measurements</span>
      <span>{{ lastTransfer }}</span>
      <span>{{ lastInteraction }}</span>
    </section>

    <div
      ref="scrollerRef"
      class="visual-row-fixture-scroller"
    >
      <div
        class="visual-row-fixture-canvas"
        :style="{ height: `${totalSize}px` }"
      >
        <div
          v-for="entry in virtualRows"
          :key="entry.virtualItem.key"
          :ref="measureElement"
          class="visual-row-fixture-positioner"
          :data-index="entry.virtualItem.index"
          :style="{ transform: `translateY(${entry.virtualItem.start}px)` }"
        >
          <ConversationVisualRowCanvasItem
            :row="entry.row"
            :messages="messages"
            @copy-turn="copyTurn"
            @save-turn="saveTurn"
            @edit-message="recordInteraction('edit', $event)"
            @regenerate-response="recordInteraction('regenerate', $event)"
          />
        </div>
      </div>
    </div>
    <ConversationAnswerRenderHost
      ref="baselineAnswerHostRef"
      :answers="transferBaselineAnswers"
      :width-px="680"
    />
    <ConversationAnswerRenderHost
      ref="answerRenderHostRef"
      :answers="activeTransferAnswers"
      :width-px="680"
    />
  </main>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue';
import { useConversationVisualRowFixture } from '../orchestration/useConversationVisualRowFixture';
import ConversationVisualRowCanvasItem from './ConversationVisualRowCanvasItem.vue';
import ConversationAnswerRenderHost from '../../../ui/tools/knowledge/clipboard/ui/ConversationAnswerRenderHost.vue';
import { useRenderedAnswerTransferHost } from '../../../ui/tools/knowledge/clipboard/orchestration/useRenderedAnswerTransferHost';
import type { RenderedAnswerHostExposed } from '../../../ui/tools/knowledge/clipboard/orchestration/useRenderedAnswerTransferHost';
import { RENDERED_ANSWER_TRANSFER_PORT_KEY } from '../../../ui/tools/knowledge/clipboard/definitions/renderedAnswerTransfer';
import '../styles/conversationVisualRowFixture.css';

const scrollerRef = ref<globalThis.HTMLElement | null>(null);
const baselineAnswerHostRef = ref<RenderedAnswerHostExposed | null>(null);
const {
  activeAnswers: activeTransferAnswers,
  hostRef: answerRenderHostRef,
  port: renderedAnswerTransferPort,
} = useRenderedAnswerTransferHost();
provide(RENDERED_ANSWER_TRANSFER_PORT_KEY, renderedAnswerTransferPort);
const {
  gateReport,
  lastInteraction,
  lastTransfer,
  measureElement,
  measurementSnapshot,
  messages,
  rows,
  runGates,
  saveTurn,
  copyTurn,
  recordInteraction,
  totalSize,
  transferBaselineAnswers,
  virtualRows,
} = useConversationVisualRowFixture(scrollerRef, {
  baselineAnswerHostRef,
  renderedAnswerTransferPort,
});
</script>
