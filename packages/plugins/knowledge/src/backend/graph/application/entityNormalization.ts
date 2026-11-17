/**
 * @file entityNormalization.ts
 *
 * @description
 * 实体规范化（Milestone 2）。
 *
 * 目标：
 * - 把“展示名 / 抽取原始名”收敛成稳定的 canonical_name；
 * - 再从 canonical_name 生成较稳定的 canonical_id（用于节点/边连接）。
 *
 * 设计取舍（与计划一致）：
 * - 不追求完美消歧：允许 canonical_id 冲突，语义消歧交给向量层/上层策略；
 * - 非英文策略明确：本期“保留中文并做简单归一”，不做拼音转换；
 * - 空字符串/全是符号：返回空字符串，由上层拒绝入库或降级处理。
 */

/**
 * 将原始输入转成 canonical_name（规范名）
 *
 * 规则（可预测、可解释）：
 * - Unicode 归一：NFKC（处理全角/兼容字符）
 * - 去掉首尾空白
 * - 将“标点/符号/分隔符”统一视为分词边界（变成空格）
 * - 折叠多空格为单空格
 * - 英文大小写：只对 ASCII 字母做 toLowerCase（避免对某些语言产生不可预期变化）
 *
 * @example
 * - "APPLE " -> "apple"
 * - "Apple Inc." -> "apple inc"
 * - "  苹果公司（Apple） " -> "苹果公司 apple"
 */
export function toCanonicalName(raw: string): string {
  const input = typeof raw === 'string' ? raw : '';
  const nfkc = input.normalize('NFKC').trim();
  if (nfkc.length === 0) return '';

  const tokens: string[] = [];
  let current = '';

  const flush = (): void => {
    const t = current.trim();
    if (t.length > 0) tokens.push(t);
    current = '';
  };

  for (const ch of nfkc) {
    // 字母/数字：保留
    // - 使用 unicode property escapes，覆盖中文/英文/数字等
    if (/[\p{L}\p{N}]/u.test(ch)) {
      // 仅对 ASCII A-Z 做小写，其他字符保持原样
      if (ch >= 'A' && ch <= 'Z') {
        current += ch.toLowerCase();
      } else {
        current += ch;
      }
      continue;
    }

    // 其余字符（标点/符号/空白等）统一作为分隔符
    flush();
  }

  flush();
  return tokens.join(' ');
}

/**
 * 从 canonical_name 生成 canonical_id（用于较稳定的实体 ID）
 *
 * 规则：
 * - 输入先 trim；空则返回空
 * - Unicode NFKC
 * - 将空白/下划线等分隔符转为 "-"
 * - 仅保留：字母/数字/中文 + "-"（其余丢弃）
 * - 折叠多个 "-" 并去掉首尾 "-"
 * - 英文大小写：只对 ASCII 字母做 toLowerCase
 *
 * @example
 * - "apple inc" -> "apple-inc"
 * - "苹果公司 apple" -> "苹果公司-apple"
 */
export function toCanonicalId(canonicalName: string): string {
  const input = typeof canonicalName === 'string' ? canonicalName : '';
  const nfkc = input.normalize('NFKC').trim();
  if (nfkc.length === 0) return '';

  let out = '';
  let prevWasDash = false;

  for (const ch of nfkc) {
    // 允许：字母/数字（含中文）
    if (/[\p{L}\p{N}]/u.test(ch)) {
      const normalized = ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch;
      out += normalized;
      prevWasDash = false;
      continue;
    }

    // 分隔符：空白、下划线、连字符族都视为 "-"
    if (/[\s_\-]/u.test(ch)) {
      if (!prevWasDash && out.length > 0) {
        out += '-';
        prevWasDash = true;
      }
      continue;
    }

    // 其他标点/符号：直接丢弃（不引入新的分隔，避免产生多余 "-")
  }

  // 去掉末尾 "-"
  while (out.endsWith('-')) {
    out = out.slice(0, -1);
  }
  return out;
}


