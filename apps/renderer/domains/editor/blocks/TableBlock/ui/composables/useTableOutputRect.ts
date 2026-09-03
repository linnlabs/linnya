/**
 * @file apps/renderer/features/TableBlock/ui/composables/useTableOutputRect.ts
 *
 * @brief 表格输出区域计算工具函数
 *
 * @description
 * 提供表格输出区域的辅助工具函数：
 * - 输出矩形的验证和描述（UI层辅助工具）
 *
 * @note 输出列配置由同目录的 tableAiSelectionContext.ts 统一计算，
 *       此 composable 只保留 UI 层展示相关能力。
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { TableRect, OutputRect } from './types/tableAiTypes';

/**
 * 表格输出区域计算工具函数
 * @returns 输出区域计算相关的工具方法
 */
export function useTableOutputRect() {

  /**
   * 计算添加列后的输出矩形
   * @param originalRect - 原始选区矩形
   * @returns 更新后的输出矩形
   */
  const createOutputRectAfterColumnAdd = (originalRect: TableRect): OutputRect => {
    return {
      left: originalRect.right,           // 新添加的列
      right: originalRect.right + 1,      // 宽度为1列
      top: originalRect.top,
      bottom: originalRect.bottom,
      isOutputColumn: true,
      needsNewColumn: false // 列已经添加了
    };
  };

  /**
   * 检查是否需要添加新列
   * @param rect - 选区矩形
   * @param tableNode - 表格节点
   * @returns 是否需要添加新列
   */
  const needsNewColumn = (rect: TableRect, tableNode: ProseMirrorNode): boolean => {
    if (!rect || !tableNode) return false;
    
    const tableWidth = tableNode.firstChild?.childCount || 0;
    return rect.right >= tableWidth;
  };

  /**
   * 获取输出列的列索引
   * @param rect - 原始选区矩形
   * @returns 输出列的列索引
   */
  const getOutputColumnIndex = (rect: TableRect): number => {
    return rect.right;
  };

  /**
   * 验证输出矩形是否有效
   * @param outputRect - 输出矩形
   * @param tableNode - 表格节点
   * @returns 是否有效
   */
  const isValidOutputRect = (outputRect: OutputRect, tableNode: ProseMirrorNode): boolean => {
    if (!outputRect || !tableNode) return false;
    
    const tableWidth = tableNode.firstChild?.childCount || 0;
    const tableHeight = tableNode.childCount || 0;
    
    // 检查矩形边界是否在表格范围内
    return (
      outputRect.left >= 0 &&
      outputRect.right <= tableWidth &&
      outputRect.top >= 0 &&
      outputRect.bottom <= tableHeight &&
      outputRect.left < outputRect.right &&
      outputRect.top < outputRect.bottom
    );
  };

  /**
   * 计算输出矩形的高度
   * @param outputRect - 输出矩形
   * @returns 矩形高度
   */
  const getOutputRectHeight = (outputRect: OutputRect): number => {
    return outputRect.bottom - outputRect.top;
  };

  /**
   * 计算输出矩形的宽度
   * @param outputRect - 输出矩形
   * @returns 矩形宽度
   */
  const getOutputRectWidth = (outputRect: OutputRect): number => {
    return outputRect.right - outputRect.left;
  };

  /**
   * 创建输出矩形的描述字符串
   * @param outputRect - 输出矩形
   * @returns 描述字符串，如 "E1:E3"
   */
  const getOutputRectDescription = (outputRect: OutputRect): string => {
    const startCol = String.fromCharCode(65 + outputRect.left); // A=65
    const endCol = String.fromCharCode(65 + outputRect.right - 1);
    const startRow = outputRect.top + 1;
    const endRow = outputRect.bottom;
    
    if (outputRect.left === outputRect.right - 1 && outputRect.top === outputRect.bottom - 1) {
      // 单个单元格
      return `${startCol}${startRow}`;
    } else if (outputRect.left === outputRect.right - 1) {
      // 单列多行
      return `${startCol}${startRow}:${startCol}${endRow}`;
    } else if (outputRect.top === outputRect.bottom - 1) {
      // 多列单行
      return `${startCol}${startRow}:${endCol}${startRow}`;
    } else {
      // 多列多行
      return `${startCol}${startRow}:${endCol}${endRow}`;
    }
  };

  /**
   * 比较两个输出矩形是否相等
   * @param rect1 - 第一个矩形
   * @param rect2 - 第二个矩形
   * @returns 是否相等
   */
  const isOutputRectEqual = (rect1: OutputRect | null, rect2: OutputRect | null): boolean => {
    if (!rect1 && !rect2) return true;
    if (!rect1 || !rect2) return false;
    
    return (
      rect1.left === rect2.left &&
      rect1.right === rect2.right &&
      rect1.top === rect2.top &&
      rect1.bottom === rect2.bottom
    );
  };

  /**
   * 复制输出矩形
   * @param outputRect - 要复制的矩形
   * @returns 复制的矩形
   */
  const cloneOutputRect = (outputRect: OutputRect): OutputRect => {
    return {
      ...outputRect,
      isOutputColumn: true
    };
  };

  return {
    createOutputRectAfterColumnAdd,
    needsNewColumn,
    getOutputColumnIndex,
    isValidOutputRect,
    getOutputRectHeight,
    getOutputRectWidth,
    getOutputRectDescription,
    isOutputRectEqual,
    cloneOutputRect
  };
}
