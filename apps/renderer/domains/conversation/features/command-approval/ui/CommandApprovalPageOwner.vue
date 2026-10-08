<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { mountCommandApprovalPage } from '../orchestration/useCommandApproval';

const lifetime = new AbortController();

onMounted(() => {
  // openPage 仍在 IPC 往返中时也要能结束本页，不能等待响应后才取得清理函数。
  void mountCommandApprovalPage(undefined, lifetime.signal);
});

onBeforeUnmount(() => lifetime.abort());
</script>
