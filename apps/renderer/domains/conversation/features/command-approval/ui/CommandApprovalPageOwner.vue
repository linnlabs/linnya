<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { mountCommandApprovalPage } from '../orchestration/useCommandApproval';

let disposePage: (() => void) | undefined;
let ownerEnded = false;

onMounted(async () => {
  const dispose = await mountCommandApprovalPage();
  // 打开页面与组件卸载可能交错；迟到的订阅也必须立即释放，不能遗留第二个页面 owner。
  if (ownerEnded) {
    dispose();
    return;
  }
  disposePage = dispose;
});

onBeforeUnmount(() => {
  ownerEnded = true;
  disposePage?.();
  disposePage = undefined;
});
</script>
