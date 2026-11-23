import { defineAsyncComponent } from 'vue';

// 整页视图按需加载；侧栏角标、折叠行只读 store，不带上整套表单。
export const ScheduledTasksView = defineAsyncComponent(() => import('./ui/ScheduledTasksView.vue'));
export { useScheduledTasksStore } from './store/scheduledTasksStore';
export { startScheduledTasksLifecycle } from './orchestration/startScheduledTasksLifecycle';
export { refreshScheduledTasks } from './orchestration/refreshScheduledTasks';
export { ensureScheduledTasksLocalizationRegistered } from './orchestration/ensureScheduledTasksLocalizationRegistered';
export { useScheduledTaskLocalization } from './ui/useScheduledTaskLocalization';
export { startScheduledTasksAppLifecycle } from './orchestration/startScheduledTasksAppLifecycle';
