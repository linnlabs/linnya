import { registerMessageCatalogs, useLocalization } from '@/app/localization';

const zh = {
  'history.title': '历史版本',
  'history.current': '当前版本',
  'history.restoredFrom': '恢复自 {time} 的版本',
  'history.earlier': '更早版本',
  'history.loading': '正在加载历史版本…',
  'history.empty': '暂无历史版本',
  'history.restore': '恢复此版本',
  'history.close': '关闭',
  'history.cancel': '取消',
  'history.confirm': '恢复会将所选内容保存为一个新版本。是否继续？',
  'history.confirmDetails': '历史版本与草稿',
  'history.confirmNewer': '不会将所选版本之后的历史全部删除。',
  'history.confirmRecent': '最近 5 个成功版本（含新恢复版本）完整保留，恢复前的当前版本仍可找回。',
  'history.confirmOlder': '更早版本按时间间隔选留，其余可能在本次恢复或后续保存时被清理。',
  'history.confirmDraft': '当前失败草稿（如有）会被清除。',
  'history.readonly': '只读预览',
  'history.refresh': '刷新列表',
  'history.restored': '已恢复为新版本。若想回到恢复前，请在历史列表中选择之前的版本再恢复。',
  'history.restoring': '正在恢复…',
  'history.restoreInProgress': '正在恢复，关闭窗口不会取消已提交的恢复操作。',
  'history.error.document_not_found': '文档不存在或已删除。',
  'history.error.history_unavailable': '历史版本暂不可用，请重新打开或检查插件是否启用。',
  'history.error.version_not_found':
    '此历史版本已被清理，列表已刷新。当前文档未被修改，请重新选择。',
  'history.error.version_conflict': '文档刚刚被修改，已刷新历史。请选择版本并重新确认。',
  'history.error.version_corrupt': '历史版本校验失败，未修改当前文档。',
  'history.error.preview_failed': '历史版本预览失败。',
  'history.error.restore_failed': '恢复失败，当前文档未被替换。',
} as const;
const en: Record<keyof typeof zh, string> = {
  'history.title': 'Version history',
  'history.current': 'Current version',
  'history.restoredFrom': 'Restored from {time}',
  'history.earlier': 'Earlier versions',
  'history.loading': 'Loading version history…',
  'history.empty': 'No version history',
  'history.restore': 'Restore this version',
  'history.close': 'Close',
  'history.cancel': 'Cancel',
  'history.confirm': 'Restoring saves the selected content as a new version. Continue?',
  'history.confirmDetails': 'Version history and drafts',
  'history.confirmNewer': 'Versions after the selected one are not all deleted.',
  'history.confirmRecent':
    'The latest 5 successful versions, including the restored version, are kept. You can return to the version that is current now.',
  'history.confirmOlder':
    'Older versions are kept at spaced time intervals. Others may be removed during this restore or later saves.',
  'history.confirmDraft': 'Any failed draft will be cleared.',
  'history.readonly': 'Read-only preview',
  'history.refresh': 'Refresh list',
  'history.restored':
    'Restored as a new version. To go back, select the previous version in history and restore it.',
  'history.restoring': 'Restoring…',
  'history.restoreInProgress':
    'Restoring. Closing this window will not cancel the submitted restore operation.',
  'history.error.document_not_found': 'This document no longer exists.',
  'history.error.history_unavailable':
    'Version history is unavailable. Reopen it or check whether the plugin is enabled.',
  'history.error.version_not_found':
    'This version was removed by retention. The list has been refreshed. The current document is unchanged; select another version.',
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
    message: (key: keyof typeof zh, params?: Readonly<Record<string, string | number>>) =>
      locale.message(key, zh[key], params),
  };
}
