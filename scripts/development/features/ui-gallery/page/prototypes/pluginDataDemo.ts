/**
 * 插件卸载与本机数据预览的示例数据（画廊专用，不是产品合同）。
 * 类别对应插件 manifest 声明的数据目录类别：原文（source）、可重建的索引（derived）、日志与临时文件（runtime）。
 */

const MB = 1024 * 1024;

export interface PluginDataRow {
  readonly id: 'source' | 'derived' | 'runtime';
  readonly label: string;
  readonly bytes: number;
  readonly note: string;
}

/** 知识库有用户资料时的本机数据。 */
export const KNOWLEDGE_DATA_ROWS: readonly PluginDataRow[] = [
  { id: 'source', label: '原文与解析结果', bytes: 860 * MB, note: '删除后无法恢复，只能重新上传' },
  { id: 'derived', label: '检索索引', bytes: 338 * MB, note: '可以重建，需要重新调用嵌入模型' },
  { id: 'runtime', label: '日志与临时文件', bytes: 12 * MB, note: '' },
];

export const KNOWLEDGE_RECORDS_TEXT = '3 个知识库 · 128 份资料';

/** 老用户只有旧版本留下的空索引和日志，没有资料。 */
export const LEFTOVER_DATA_ROWS: readonly PluginDataRow[] = [
  { id: 'derived', label: '空的检索索引', bytes: 128 * MB, note: '以前的版本自动建的，里面没有资料' },
  { id: 'runtime', label: '日志与临时文件', bytes: 12 * MB, note: '' },
];

export function sumBytes(rows: readonly PluginDataRow[]): number {
  return rows.reduce((total, row) => total + row.bytes, 0);
}

/** 1024 进制，与界面现有大小显示一致；预览只需要 MB/GB 两档。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export type CleanupFailureReason = 'busy' | 'permission' | 'interrupted' | 'stopped' | 'disk-full';

export const CLEANUP_FAILURE_LABELS: Readonly<Record<CleanupFailureReason, string>> = {
  busy: '文件被占用',
  permission: '没有权限',
  interrupted: '删除中途退出',
  stopped: '手动停止',
  'disk-full': '磁盘已满',
};

/** 失败原因的用户可读说明：说清卡在哪、用户能做什么。 */
export const CLEANUP_FAILURE_COPY: Readonly<Record<CleanupFailureReason, string>> = {
  busy: '有 1 个文件正被其他程序打开：2025 年报.pdf。关闭打开它的程序后重试。',
  permission: '没有权限删除 3 个文件。检查这些文件的访问权限后重试。',
  interrupted: '上次删除时 Linnya 退出了，剩下的数据还在。点重试会接着删。',
  stopped: '你停止了删除，剩下的数据还在。点重试会接着删。',
  'disk-full': '磁盘空间不足，最后一步清理数据库记录没有完成。腾出一些空间后重试。',
};

/** 只有文件被占用或没有权限时，给出打开文件位置的入口。 */
export function canRevealCleanupBlocker(reason: CleanupFailureReason): boolean {
  return reason === 'busy' || reason === 'permission';
}
