import type { LayoutTableNode } from './LayoutTypes';
import { parseTableDataLike } from '../inputParsers/dataParsers';
import { FlexComposeContractError } from './FlexComposeContractError';

/** 测量与最终元素构建消费相同的 tableData/top-level 优先级和严格单元格准入。 */
export function readLayoutTableData(node: LayoutTableNode) {
  const parsed = parseTableDataLike({
    ...(node.tableData ?? {}),
    headers: node.headers ?? node.tableData?.headers,
    rows: node.rows ?? node.tableData?.rows ?? node.tableData?.body ?? node.tableData?.data,
  });
  if (parsed.error || !parsed.data) {
    throw new FlexComposeContractError(parsed.error ?? 'Table 数据解析失败。');
  }
  return parsed.data;
}
