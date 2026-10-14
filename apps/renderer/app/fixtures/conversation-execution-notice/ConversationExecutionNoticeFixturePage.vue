<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { ConversationExecutionNoticeMetadataSchema } from '@app/schemas';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../domains/conversation/definitions/conversationRenderScope';
import { useInteractiveRunStore } from '../../../domains/conversation/features/interactive-run';
import {
  SUBRUN_EXECUTION_SCOPE_KEY,
  executionActivity,
} from '../../../domains/conversation/shared/execution-presentation';
import type { ExecutionNoticeMessage } from '../../../domains/conversation/features/error-surface/definitions/executionNotice';
import ExecutionNotice from '../../../domains/conversation/ui/message/ExecutionNoticeMessage.vue';

const conversationId = 'fixture-retry';
const executionId = 'fixture-execution';
provide(CONVERSATION_RENDER_SCOPE_KEY, { conversationId });
const control = useInteractiveRunStore();
const status = ref<'running' | 'paused'>('running');
function synchronize(): void {
  control.synchronizeSnapshot(conversationId, {
    conversationId,
    runId: 'fixture-run',
    executionId,
    status: status.value,
    ...(status.value === 'paused' ? { pause: { settled: true, updatedAt: Date.now() } } : {}),
  });
}
synchronize();
provide(SUBRUN_EXECUTION_SCOPE_KEY, {
  conversationId,
  runId: () => 'fixture-child',
  activity: computed(() => ({ ...executionActivity(status.value), executionId })),
});
const startedAt = Date.now();
function message(
  id: string,
  retryStatus: 'waiting' | 'succeeded' | 'exhausted',
  child = false
): ExecutionNoticeMessage {
  return {
    id,
    role: 'system',
    type: 'execution_notice',
    timestamp: startedAt,
    content: '',
    metadata: ConversationExecutionNoticeMetadataSchema.parse({
      run_id: child ? 'fixture-child' : 'fixture-run',
      turn_id: 'fixture-turn',
      execution_id: executionId,
      error_code: 'llm.network_error',
      retry: {
        retry_id: id,
        category: 'transport',
        status: retryStatus,
        attempt: retryStatus === 'exhausted' ? 6 : 1,
        max_retries: 6,
        total_attempts: retryStatus === 'exhausted' ? 7 : 2,
        started_at: startedAt,
        updated_at: startedAt + 4000,
        ...(retryStatus === 'waiting' ? { next_retry_at: startedAt + 60000 } : {}),
      },
    }),
  };
}
const notices = [
  message('waiting', 'waiting'),
  message('failed', 'exhausted'),
  message('recovered', 'succeeded'),
  message('child-waiting', 'waiting', true),
];
function toggle(): void {
  status.value = status.value === 'running' ? 'paused' : 'running';
  synchronize();
}
</script>
<template>
  <main style="max-width: 780px; margin: 48px auto; padding: 24px">
    <h1>会话重试通知</h1>
    <p>真实通知组件 · 无模型请求 · 当前状态 {{ status }}</p>
    <button type="button" @click="toggle">切换暂停 / 运行</button>
    <section v-for="(notice, index) in notices" :key="notice.id" style="margin-top: 28px">
      <p>{{ ['等待重试', '重试耗尽', '已经恢复', '子 Agent 通知'][index] }}</p>
      <ExecutionNotice :message="notice" />
    </section>
  </main>
</template>
