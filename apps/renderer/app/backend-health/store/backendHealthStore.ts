import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  isAppServerUnavailable,
  type AppServerHealthStatus,
} from '../../../../../src/shared/app-server-health/definitions/appServerHealthMessage';

/** 后台服务状态的 Renderer 投影；只保存 Main 推来的快照。 */
export const useBackendHealthStore = defineStore('backend-health', () => {
  const status = ref<AppServerHealthStatus>('ok');
  /** 后台停了：请求必然失败，界面不逐条报错，也不展示过时的运行状态。 */
  const isUnavailable = computed(() => isAppServerUnavailable(status.value));

  function applyStatus(next: AppServerHealthStatus): void {
    status.value = next;
  }

  return { status, isUnavailable, applyStatus };
});
