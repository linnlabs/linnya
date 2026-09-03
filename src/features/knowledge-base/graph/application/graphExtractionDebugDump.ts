/**
 * @file graphExtractionDebugDump.ts
 *
 * @description
 * 仅用于开发者调试：将“图谱抽取”的模型输出与解析后的 JSON 结果落盘，便于人工检查提示词效果。
 *
 * 设计原则：
 * - 默认关闭（不产生任何文件，不影响性能）。
 * - 开关开启后，写入 `_dev_data/logs/kg-extraction/...`（或生产环境 workspaceRoot/logs 下）。
 * - 该能力属于“日志/审计”，写盘失败不应影响抽取主流程（避免 debug 影响业务可用性）。
 */
import fsp from 'fs/promises';
import path from 'path';

import { pathManager } from '../../../../shared/utils/pathManager';

export type GraphExtractionDumpBatchItem = {
  chunk_id: string;
  entities: unknown;
  edges: unknown;
};

export type GraphExtractionDumpBatch = {
  kbId: string;
  docId: string;
  modelId: string;
  chunkIds: string[];
  rawText: string;
  parsedJsonText: string;
  parsed: GraphExtractionDumpBatchItem[];
  createdAtIso: string;
};

function formatBeijingTimestampForFilename(date: Date): string {
  /**
   * 需求：文件名以北京时间开头，便于人工按时间排序与定位。
   *
   * 约定：
   * - 使用 Asia/Shanghai（北京时间，UTC+8，含夏令时规则但中国当前无夏令时）
   * - 格式：YYYY-MM-DD_HH-mm-ss.SSS（24小时制）
   */
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : '00';
  };

  const yyyy = pick('year');
  const mm = pick('month');
  const dd = pick('day');
  const HH = pick('hour');
  const MM = pick('minute');
  const SS = pick('second');
  const mmm = String(date.getMilliseconds()).padStart(3, '0');

  return `${yyyy}-${mm}-${dd}_${HH}-${MM}-${SS}.${mmm}`;
}

function formatBeijingIsoLike(date: Date): string {
  /**
   * 便于读：在 JSON 内容中写入北京时间（无时区歧义）。
   * 例如：2026-01-10T14:23:45.123+08:00
   */
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : '00';
  };

  const yyyy = pick('year');
  const mm = pick('month');
  const dd = pick('day');
  const HH = pick('hour');
  const MM = pick('minute');
  const SS = pick('second');
  const mmm = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}.${mmm}+08:00`;
}

function normalizeEnvBool(v: string | undefined): boolean {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * 开关：开启后会把抽取 JSON 落盘（开发者自查提示词质量用）。
 *
 * 用法：
 * - `LINNYA_KG_DUMP_JSON=1`
 */
export function isGraphExtractionDumpEnabled(): boolean {
  return normalizeEnvBool(process.env.LINNYA_KG_DUMP_JSON);
}

function sanitizeForPathSegment(input: string): string {
  // 文件系统安全：仅保留常见可读字符，其余替换为 '_'
  const s = typeof input === 'string' ? input : '';
  const trimmed = s.trim();
  if (trimmed.length === 0) return 'unknown';
  return trimmed.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}

/**
 * 将 batch 抽取的输出落盘（JSON）。
 *
 * 路径：
 * - `<workspaceRoot>/logs/kg-extraction/<kbId>/<docId>/<ts>.<modelId>.json`
 */
export async function dumpGraphExtractionBatchIfEnabled(data: GraphExtractionDumpBatch): Promise<void> {
  if (!isGraphExtractionDumpEnabled()) return;

  try {
    const logDir = pathManager.getLogDirectory();
    const dir = path.join(
      logDir,
      'kg-extraction',
      sanitizeForPathSegment(data.kbId),
      sanitizeForPathSegment(data.docId)
    );
    await fsp.mkdir(dir, { recursive: true });

    const now = new Date();
    const ts = Date.now();
    const model = sanitizeForPathSegment(data.modelId);
    const beijingPrefix = formatBeijingTimestampForFilename(now);
    const fileName = `${beijingPrefix}.${ts}.${model}.batch_${data.chunkIds.length}.json`;
    const filePath = path.join(dir, fileName);

    // 开发者可读：缩进输出，便于直接打开检查
    await fsp.writeFile(
      filePath,
      JSON.stringify(
        {
          ...data,
          // 追加北京时间，便于人工对齐日志；不替换 createdAtIso（避免破坏既有语义）
          createdAtBeijing: formatBeijingIsoLike(now),
        },
        null,
        2
      ),
      { encoding: 'utf8' }
    );
    // 仅提示路径：避免把大 JSON 打到 stdout
    // eslint-disable-next-line no-console
    console.log(`[KG-DUMP] graph extraction batch dumped: ${filePath}`);
  } catch (error) {
    // 注意：这是开发者调试能力，写盘失败不应影响抽取主流程
    // eslint-disable-next-line no-console
    console.warn('[KG-DUMP] graph extraction dump failed:', error);
  }
}


