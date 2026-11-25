import type { MessageCatalogContribution } from '@app/localization';
import type { WindowCloseMessageKey } from './windowCloseMessages';

export const WINDOW_CLOSE_MESSAGE_FALLBACKS = {
  'windowClose.exit.title': '退出 Linnya？',
  'windowClose.running.commands': '正在运行的命令会停止。',
  'windowClose.running.scheduled': '{count} 个正在运行的定时任务会中断。',
  'windowClose.running.commandsAndScheduled': '正在运行的命令会停止，{count} 个定时任务会中断。',
  'windowClose.running.confirm': '停止并退出',
  'windowClose.unknown.message': '没能确认有没有任务在运行，退出会停止所有任务。',
  'windowClose.saveFailed.title': '有修改没能保存',
  'windowClose.saveFailed.message': '继续会丢失这些修改。',
  'windowClose.confirm.exit': '仍要退出',
  'windowClose.confirm.restartUpdate': '仍要重启更新',
  'windowClose.cancel': '返回',
} as const satisfies Readonly<Record<WindowCloseMessageKey, string>>;

export const WINDOW_CLOSE_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'app-window-close',
  catalogs: {
    'zh-CN': WINDOW_CLOSE_MESSAGE_FALLBACKS,
    'en-US': {
      'windowClose.exit.title': 'Quit Linnya?',
      'windowClose.running.commands': 'Running commands will be stopped.',
      'windowClose.running.scheduled': 'Scheduled tasks that will be interrupted: {count}.',
      'windowClose.running.commandsAndScheduled': 'Running commands will be stopped. Scheduled tasks that will be interrupted: {count}.',
      'windowClose.running.confirm': 'Stop and quit',
      'windowClose.unknown.message': 'Linnya could not check for running tasks. Quitting stops any that are running.',
      'windowClose.saveFailed.title': 'Some changes were not saved',
      'windowClose.saveFailed.message': 'Continuing discards them.',
      'windowClose.confirm.exit': 'Quit anyway',
      'windowClose.confirm.restartUpdate': 'Restart anyway',
      'windowClose.cancel': 'Go back',
    } satisfies Readonly<Record<WindowCloseMessageKey, string>>,
  },
};
