import type { MessageCatalogContribution } from '@app/localization';
import type { UpdateMessageKey } from './updateMessages';

export const UPDATE_MESSAGE_FALLBACKS = {
  'update.dialog.releaseNotes': '更新日志',
  'update.dialog.downloadProgress': '下载进度',
  'update.dialog.installing.title': '正在安装并重启',
  'update.dialog.installing.description': '林芽会自动完成安装并重新打开。',
  'update.dialog.error.title': '更新出错了',
  'update.dialog.error.default': '更新失败',
  'update.dialog.error.ipcUnavailable': '更新 IPC 不可用: {channel}',
  'update.dialog.error.dynamic': '更新失败，请稍后重试。',
  'update.dialog.actions.remindLater': '稍后提醒',
  'update.dialog.actions.updateNow': '立即更新',
  'update.dialog.actions.close': '关闭',
  'update.dialog.actions.retry': '重试',
  'update.dialog.title.installing': '正在安装更新',
  'update.dialog.title.available': '发现新版本',
  'update.dialog.title.availableWithVersion': '发现新版本 {version}',
  'update.dialog.busy.installingRestart': '正在安装并重启',
  'update.dialog.busy.downloading': '下载中',
} as const satisfies Readonly<Record<UpdateMessageKey, string>>;

export const UPDATE_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'app-update',
  catalogs: {
    'zh-CN': UPDATE_MESSAGE_FALLBACKS,
    'en-US': {
      'update.dialog.releaseNotes': 'Release notes',
      'update.dialog.downloadProgress': 'Download progress',
      'update.dialog.installing.title': 'Installing and restarting',
      'update.dialog.installing.description': 'Linnya will finish installing and reopen automatically.',
      'update.dialog.error.title': 'Update failed',
      'update.dialog.error.default': 'Update failed',
      'update.dialog.error.ipcUnavailable': 'Update IPC is unavailable: {channel}',
      'update.dialog.error.dynamic': 'Update failed. Please try again later.',
      'update.dialog.actions.remindLater': 'Remind me later',
      'update.dialog.actions.updateNow': 'Update now',
      'update.dialog.actions.close': 'Close',
      'update.dialog.actions.retry': 'Retry',
      'update.dialog.title.installing': 'Installing update',
      'update.dialog.title.available': 'New version available',
      'update.dialog.title.availableWithVersion': 'New version {version} available',
      'update.dialog.busy.installingRestart': 'Installing and restarting',
      'update.dialog.busy.downloading': 'Downloading',
    },
  },
};
