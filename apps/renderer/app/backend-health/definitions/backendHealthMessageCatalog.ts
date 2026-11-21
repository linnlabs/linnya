import type { MessageCatalogContribution } from '@app/localization';
import type { BackendHealthMessageKey } from './backendHealthMessages';

export const BACKEND_HEALTH_MESSAGE_FALLBACKS = {
  'backendHealth.restarting': '后台服务意外停止，正在重新启动…',
  'backendHealth.recovered': '已恢复。中断的对话在侧栏标了红点，可以接着做。',
  'backendHealth.stopped': '后台服务反复停止，已暂停自动重启。',
  'backendHealth.unresponsive': '后台服务 15 秒没有响应，可能正在处理大量内容。',
  'backendHealth.actions.restart': '重新启动',
  'backendHealth.actions.restartBackend': '重新启动后台服务',
  'backendHealth.actions.openLogFolder': '查看日志',
  'backendHealth.restartConfirm.title': '重新启动后台服务？',
  'backendHealth.restartConfirm.message': 'Linnya 会关闭后重新打开，正在运行的对话会被中断，之后可以接着做。已保存的内容不受影响。',
  'backendHealth.restartFailed': '没能重新启动，请退出 Linnya 后再打开。',
} as const satisfies Readonly<Record<BackendHealthMessageKey, string>>;

export const BACKEND_HEALTH_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'app-backend-health',
  catalogs: {
    'zh-CN': BACKEND_HEALTH_MESSAGE_FALLBACKS,
    'en-US': {
      'backendHealth.restarting': 'The background service stopped unexpectedly. Restarting…',
      'backendHealth.recovered': 'Recovered. Interrupted conversations are marked with a red dot in the sidebar and can be continued.',
      'backendHealth.stopped': 'The background service keeps stopping, so automatic restart is paused.',
      'backendHealth.unresponsive': 'The background service has not responded for 15 seconds. It may be busy with a lot of content.',
      'backendHealth.actions.restart': 'Restart',
      'backendHealth.actions.restartBackend': 'Restart background service',
      'backendHealth.actions.openLogFolder': 'View logs',
      'backendHealth.restartConfirm.title': 'Restart the background service?',
      'backendHealth.restartConfirm.message': 'Linnya will close and reopen. Running conversations will be interrupted and can be continued afterwards. Saved content is not affected.',
      'backendHealth.restartFailed': 'Could not restart. Quit Linnya and open it again.',
    },
  },
};
