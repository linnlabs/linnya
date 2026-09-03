/**
 * @file citations/normalizeUrl.ts
 * @description URL 规范化工具
 *
 * 根因说明：
 * Web 引用以 URL 作为稳定锚点（编辑器 citation 体系的 sourceId 也是 URL），
 * 因此同一网页在不同形式 URL 下必须尽量归一，否则会导致：
 * - 同源去重失败（一个网页变成多条来源）
 * - ref 生成不稳定（同一网页不同 ref）
 *
 * 规范化策略：
 * - 解析为 URL 对象并标准化 pathname
 * - 去掉常见追踪参数（utm_*、fbclid 等）
 * - 移除 hash（通常不影响页面内容定位）
 * - 保留必要 query（不过度清洗导致链接失效）
 */

/** 常见追踪参数名，规范化时应移除 */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'ref',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'twclid',
  'mc_cid',
  'mc_eid',
];

/**
 * 规范化 URL，保证同一网页在不同形式 URL 下尽量归一。
 * URL 解析失败时返回原始值（不抛错，避免因 URL 格式问题阻断搜索流程）。
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    // 标准化 pathname：移除末尾多余斜杠（但保留根路径 "/"）
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';

    // 移除常见追踪参数
    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }

    // 移除 hash
    url.hash = '';

    return url.toString();
  } catch {
    return rawUrl;
  }
}
