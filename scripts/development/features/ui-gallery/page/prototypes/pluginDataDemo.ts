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
  { id: 'source', label: '原文与解析结果', bytes: 860 * MB, note: '删除后不可恢复，需重新上传' },
  { id: 'derived', label: '检索索引', bytes: 338 * MB, note: '可重建，需重新调用嵌入模型' },
  { id: 'runtime', label: '日志与临时文件', bytes: 12 * MB, note: '' },
];

export const KNOWLEDGE_RECORDS_TEXT = '3 个知识库、128 份资料';

/** 早期版本遗留的空索引和日志，不含用户资料。 */
export const LEFTOVER_DATA_ROWS: readonly PluginDataRow[] = [
  { id: 'derived', label: '空检索索引', bytes: 128 * MB, note: '早期版本自动创建，不含资料' },
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
  permission: '权限不足',
  interrupted: '意外退出',
  stopped: '手动停止',
  'disk-full': '磁盘空间不足',
};

/** 清理失败原因说明：指出失败位置与用户可采取的操作。 */
export const CLEANUP_FAILURE_COPY: Readonly<Record<CleanupFailureReason, string>> = {
  busy: '文件“2025 年报.pdf”正被其他程序占用。请关闭相关程序后重试。',
  permission: '3 个文件因权限不足无法删除。请检查文件访问权限后重试。',
  interrupted: '清理过程中 Linnya 意外退出，部分数据尚未删除。重试将继续清理。',
  stopped: '清理已手动停止，部分数据尚未删除。重试将继续清理。',
  'disk-full': '磁盘空间不足，数据库记录未能清理完成。请释放磁盘空间后重试。',
};

/** 只有文件被占用或没有权限时，给出打开文件位置的入口。 */
export function canRevealCleanupBlocker(reason: CleanupFailureReason): boolean {
  return reason === 'busy' || reason === 'permission';
}
