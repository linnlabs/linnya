<template>
  <Teleport to="body">
    <div v-if="visible" class="llm-debug-overlay" @click.self="emit('close')">
      <div class="llm-debug-panel">
        <header class="llm-debug-header">
          <div class="llm-debug-title">
            <span>{{ editorMessage('editor.providerOutboundDebug.title') }}</span>
            <span v-if="snapshot" class="llm-debug-meta">
              {{ snapshot.operation }} · {{ snapshot.route.endpoint_id }}:{{
                snapshot.route.endpoint_model_id
              }}
              · {{ snapshot.status }}
            </span>
          </div>
          <button class="llm-debug-close" @click="emit('close')">×</button>
        </header>

        <main class="llm-debug-body">
          <div class="llm-debug-toolbar">
            <button :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">
              {{ editorMessage('editor.providerOutboundDebug.overviewTab') }}
            </button>
            <button :class="{ active: activeTab === 'snapshot' }" @click="activeTab = 'snapshot'">
              {{ editorMessage('editor.providerOutboundDebug.snapshotTab') }}
            </button>
            <span v-if="loading" class="llm-debug-status">
              {{ editorMessage('editor.providerOutboundDebug.loading') }}
            </span>
            <span v-else-if="error" class="llm-debug-status error">{{ error }}</span>
            <span v-else-if="!snapshot" class="llm-debug-status">
              {{ editorMessage('editor.providerOutboundDebug.empty') }}
            </span>
          </div>

          <section class="llm-debug-content">
            <pre class="json-viewer">{{
              activeTab === 'overview' ? overviewJson : snapshotJson
            }}</pre>
          </section>
        </main>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ProviderOutboundAttemptSnapshot } from '@app/schemas/provider-outbound-audit';
import { fetchLatestProviderOutboundAttempt } from '../orchestration/fetchLatestProviderOutboundAttempt';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (event: 'close'): void }>();

const snapshot = ref<ProviderOutboundAttemptSnapshot | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const activeTab = ref<'overview' | 'snapshot'>('overview');
const { editorMessage } = useEditorLocalization();

async function loadSnapshot() {
  loading.value = true;
  error.value = null;
  try {
    snapshot.value = await fetchLatestProviderOutboundAttempt();
  } catch (cause) {
    console.error('[ProviderOutboundDebugPanel] 加载快照失败:', cause);
    error.value = editorMessage('editor.providerOutboundDebug.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (props.visible) void loadSnapshot();
});

watch(
  () => props.visible,
  visible => {
    if (!visible) return;
    activeTab.value = 'overview';
    void loadSnapshot();
  }
);

const overviewJson = computed(() => {
  if (!snapshot.value) return editorMessage('editor.providerOutboundDebug.noData');
  return JSON.stringify(
    {
      operation: snapshot.value.operation,
      status: snapshot.value.status,
      route: snapshot.value.route,
      started_at: snapshot.value.started_at,
      completed_at: snapshot.value.completed_at,
      duration_ms: snapshot.value.duration_ms,
      usage: snapshot.value.usage,
      finish_reason: snapshot.value.finish_reason,
      failure: snapshot.value.failure,
    },
    null,
    2
  );
});

const snapshotJson = computed(() =>
  snapshot.value
    ? JSON.stringify(snapshot.value, null, 2)
    : editorMessage('editor.providerOutboundDebug.noData')
);
</script>
