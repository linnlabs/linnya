/**
 * tableFillCommands.js
 * 
 * 提供表格单元格填充相关的命令
 * 
 * 设计思路：
 * - 批量填充表格单元格内容（例如 AI 生成的结果）
 * - 支持按列索引或列标题查找目标列
 * - 如果目标列不存在，可选择自动添加新列
 */

import { getDetailedCellInfoFromDocPosition } from '../position'
import {
  applyTextToTableFillTargets,
  normalizeFillRows,
  resolveTableFillTargets,
} from './tableFillTargets'

/**
 * 填充表格单元格内容
 * 
 * @param {Object} options - 填充选项
 * @param {string} options.content - 要填充的内容
 * @param {number} options.targetColumnIndex - 目标列索引（0-based）
 * @param {number[]} [options.targetRows] - 目标行索引数组（0-based），不提供则填充所有行
 * @param {boolean} [options.createColumnIfMissing=false] - 如果目标列不存在，是否自动创建
 * @param {boolean} [options.skipHeader=false] - 是否跳过表头行
 * @returns {Function} 命令函数
 * 
 * @example
 * // 填充第 2 列（索引 1）的所有数据行
 * editor.commands.fillTableCells({
 *   content: 'New Value',
 *   targetColumnIndex: 1,
 *   skipHeader: true
 * })
 * 
 * @example
 * // 填充第 3 列的特定行（索引 1, 2, 3）
 * editor.commands.fillTableCells({
 *   content: 'New Value',
 *   targetColumnIndex: 2,
 *   targetRows: [1, 2, 3]
 * })
 */
export const fillTableCells = (options) => ({ tr, state, dispatch, editor }) => {
  if (!options || options.content === undefined || options.targetColumnIndex === undefined) {
    console.warn('[fillTableCells] 无效的填充选项', options)
    return false
  }

  // 检查是否为命令能力检查
  const isCanCheck = !dispatch
  
  // 1. 获取当前表格信息
  const detailedCellInfo = getDetailedCellInfoFromDocPosition(
    state, 
    state.selection.$head.pos
  )
  
  if (!detailedCellInfo) {
    if (!isCanCheck) {
      console.warn('[fillTableCells] 当前光标不在表格中')
    }
    return false
  }
  
  if (isCanCheck) {
    // 仅检查是否可执行（光标在表格中即可）
    return true
  }

  try {
    const { 
      content, 
      targetColumnIndex, 
      targetRows = null, 
      createColumnIfMissing = false,
      skipHeader = false 
    } = options
    
    const { tableNode, tableStartPos, map } = detailedCellInfo
    const { schema } = state

    // 2. 检查目标列是否存在
    if (targetColumnIndex >= map.width) {
      if (createColumnIfMissing) {
        console.warn('[fillTableCells] 自动添加新列功能暂未实现，请先手动添加列')
        return false
      } else {
        console.warn(`[fillTableCells] 目标列索引 ${targetColumnIndex} 超出表格宽度 ${map.width}`)
        return false
      }
    }

    // 3. 确定要填充的逻辑行范围。rowspan 覆盖的同一个物理 cell 会在 target 解析阶段去重。
    const rowsToFill = normalizeFillRows({ map, targetRows, skipHeader })

    if (rowsToFill.length === 0) {
      console.warn('[fillTableCells] 没有需要填充的行')
      return false
    }

    // 4. 用 TableMap 把逻辑行列解析成真实 cell 内容范围，避免 colspan/rowspan 下写错物理 cell。
    const { targets, skipped } = resolveTableFillTargets({
      state,
      tableNode,
      tableStartPos,
      map,
      targetColumnIndex,
      rowsToFill,
    })

    if (skipped.length > 0) {
      console.warn('[fillTableCells] 部分目标单元格被跳过', skipped)
    }

    if (targets.length === 0) {
      console.warn('[fillTableCells] 没有可填充的目标单元格')
      return false
    }

    const appliedCount = applyTextToTableFillTargets({ tr, schema, targets, content })
    if (appliedCount === 0) {
      console.warn('[fillTableCells] 没有实际写入任何单元格')
      return false
    }

    // 5. 提交事务
    dispatch(tr)
    return true
    
  } catch (error) {
    console.error('[fillTableCells] 填充单元格时出错:', error)
    return false
  }
}
