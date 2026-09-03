import { describe, expect, it } from 'vitest';

import {
  analyzeConversationVueReactiveBoundary,
  runConversationVueReactiveBoundaryGuard,
} from '../guards/conversation-vue-reactive-boundary-guard';

describe('conversation Vue reactive boundary guard', () => {
  it('当前 Conversation Vue 组件不在响应式层解析协议或抛业务错误', () => {
    expect(runConversationVueReactiveBoundaryGuard()).toEqual([]);
  });

  it('拒绝 Vue 组件内的 schema parse 与 safeParse', () => {
    const source = `<script setup lang="ts">
import { UserQuoteSchema as QuoteContract } from '@app/schemas';
const parsed = UserQuoteSchema.safeParse(value);
const metadata = ConversationThoughtMessageMetadataSchema.parse(value);
QuoteContract.parse(value);
</script>`;
    expect(
      analyzeConversationVueReactiveBoundary('UserMessage.vue', source).map(item => item.rule)
    ).toEqual(['CONV-VUE-01-schema-parse', 'CONV-VUE-01-schema-parse', 'CONV-VUE-01-schema-parse']);
  });

  it('拒绝 computed 与 watch 回调直接抛错', () => {
    const source = `<script setup lang="ts">
const value = computed(() => { throw new Error('computed failed'); });
watch(source, () => { throw new Error('watch failed'); });
</script>`;
    expect(
      analyzeConversationVueReactiveBoundary('Message.vue', source).map(item => item.rule)
    ).toEqual(['CONV-VUE-02-reactive-throw', 'CONV-VUE-02-reactive-throw']);
  });

  it('追踪 reactive callback 同步调用的本地函数', () => {
    const source = `<script setup lang="ts">
function requireValue(): string { throw new Error('missing'); }
function handleChange(): void { throw new Error('watch failed'); }
const value = computed(() => requireValue());
watch(source, handleChange);
</script>`;
    expect(
      analyzeConversationVueReactiveBoundary('Message.vue', source).map(item => item.rule)
    ).toEqual(['CONV-VUE-02-reactive-throw', 'CONV-VUE-02-reactive-throw']);
  });

  it('拒绝 TypeScript composable 的 reactive callback 解析 schema 或调用公开 parser', () => {
    const source = `import { computed } from 'vue';
import {
  ConversationThoughtMessageMetadataSchema,
  parseConversationToolMessageMetadata,
} from '@app/schemas';
const first = computed(() => ConversationThoughtMessageMetadataSchema.parse(value));
const second = computed(() => parseConversationToolMessageMetadata(value));`;
    expect(
      analyzeConversationVueReactiveBoundary('useConversationState.ts', source).map(
        item => item.rule
      )
    ).toEqual(['CONV-VUE-01-schema-parse', 'CONV-VUE-01-schema-parse']);
  });

  it('允许 TypeScript admission 函数在 reactive effect 外 strict parse', () => {
    const source = `import { ConversationThoughtMessageMetadataSchema } from '@app/schemas';
export function admitThought(value: unknown) {
  return ConversationThoughtMessageMetadataSchema.parse(value);
}`;
    expect(analyzeConversationVueReactiveBoundary('admitThought.ts', source)).toEqual([]);
  });

  it('不把已转为 Promise rejection 的异步函数或延迟 callback 当成同步 reactive throw', () => {
    const source = `import { computed, watch } from 'vue';
async function reload(): Promise<void> { throw new Error('load failed'); }
function deferred(): string { throw new Error('called by library later'); }
watch(source, () => { void reload().catch(reportError); });
const options = computed(() => ({ getItemKey: () => deferred() }));`;
    expect(analyzeConversationVueReactiveBoundary('useAsyncState.ts', source)).toEqual([]);
  });

  it('允许用户动作显式失败和普通 JSON 解析', () => {
    const source = `<script setup lang="ts">
async function handleDownload(): Promise<void> {
  JSON.parse(payload);
  throw new Error('download failed');
}
</script>`;
    expect(analyzeConversationVueReactiveBoundary('Download.vue', source)).toEqual([]);
  });

  it('报告 Vue SFC 的真实行号', () => {
    const source = `<template><div /></template>

<script setup lang="ts">
const value = computed(() => {
  throw new Error('invalid');
});
</script>`;
    expect(analyzeConversationVueReactiveBoundary('Message.vue', source)[0]?.line).toBe(5);
  });
});
