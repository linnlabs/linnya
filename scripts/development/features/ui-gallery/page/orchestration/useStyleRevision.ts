import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * 主题属性或样式表变化时递增的版本号。读取实际颜色的计算以它为依赖，
 * 切换主题、候选方案或热更新 token 后自动重新测量。
 */
export function useStyleRevision(): Ref<number> {
  const revision = ref(0);
  let observer: MutationObserver | null = null;
  onMounted(() => {
    observer = new MutationObserver(() => {
      revision.value += 1;
    });
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  });
  onBeforeUnmount(() => observer?.disconnect());
  return revision;
}
