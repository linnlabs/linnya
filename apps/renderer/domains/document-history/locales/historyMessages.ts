import { registerMessageCatalogs, useLocalization } from '@/app/localization';

const zh = {
  'history.title': '历史版本',
  'history.current': '当前版本',
  'history.earlier': '更早版本',
  'history.loading': '正在加载历史版本…',
  'history.empty': '暂无历史版本',
  'history.restore': '恢复此版本',
  'history.close': '关闭',
  'history.cancel': '取消',
  'history.confirm': '恢复将创建一个新版本，当前内容仍保留在历史中。是否继续？',
  'history.restoring': '正在恢复…',
  'history.error.document_not_found': '文档不存在或已删除。',
  'history.error.history_unavailable': '历史版本暂不可用，请重新打开或检查插件是否启用。',
  'history.error.version_not_found': '此历史版本已不可用，请重新打开历史列表。',
  'history.error.version_conflict': '文档刚刚被修改，已刷新历史。请选择版本并重新确认。',
  'history.error.version_corrupt': '历史版本校验失败，未修改当前文档。',
  'history.error.preview_failed': '历史版本预览失败。',
  'history.error.restore_failed': '恢复失败，当前文档未被替换。',
} as const;
const en: Record<keyof typeof zh, string> = {
  'history.title': 'Version history',
  'history.current': 'Current version',
  'history.earlier': 'Earlier versions',
  'history.loading': 'Loading version history…',
  'history.empty': 'No version history',
  'history.restore': 'Restore this version',
  'history.close': 'Close',
  'history.cancel': 'Cancel',
  'history.confirm':
    'Restoring creates a new version. The current content remains in history. Continue?',
  'history.restoring': 'Restoring…',
  'history.error.document_not_found': 'This document no longer exists.',
  'history.error.history_unavailable':
    'Version history is unavailable. Reopen it or check whether the plugin is enabled.',
  'history.error.version_not_found': 'This version is no longer available. Reopen version history.',
  'history.error.version_conflict':
    'The document changed. History has been refreshed. Select a version and confirm again.',
  'history.error.version_corrupt':
    'Version validation failed. The current document was not changed.',
  'history.error.preview_failed': 'Version preview failed.',
  'history.error.restore_failed': 'Restore failed. The current document was not replaced.',
};
registerMessageCatalogs({ owner: 'document-history', catalogs: { 'zh-CN': zh, 'en-US': en } });
export function useHistoryMessages() {
  const locale = useLocalization();
  return {
    locale: locale.currentLocale,
    message: (key: keyof typeof zh) => locale.message(key, zh[key]),
  };
}
