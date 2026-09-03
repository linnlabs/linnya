/**
 * @file src/tools/image_generation/index.ts
 *
 * @brief 图片生成工具导出文件
 *
 * @description
 * 导出所有图片生成工具类：
 * 1. GenerateImageTool - 对话图片生成工具
 * 
 * 这些工具使 Agent 能够根据文本描述生成图片。
 */

// 导出所有工具类
export { GenerateImageTool } from './GenerateImageTool';

// 导出工具类数组，用于批量注册
import { GenerateImageTool } from './GenerateImageTool';

/**
 * 导出所有图片生成工具类数组
 */
export const imageGenerationToolClasses = [
  GenerateImageTool
] as const;
