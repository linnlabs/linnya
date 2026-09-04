/**
 * @file src/parsers/pdfParser/utils/index.ts
 *
 * **功能 (What):** PDF解析器工具函数导出模块
 * **输入 (Input):** 无
 * **输出 (Output):** 导出的工具函数
 * **副作用 (Side-effects):** 无，纯导出模块
 */

export { validateImageData, validateTargetPixels } from './imageProcessing';

export {
  PDF_RASTER_DEFAULT_TARGET_PIXELS,
  PDF_RASTER_JPEG_QUALITY,
} from '../definitions/pdfRaster';

// 🔥 Token计算功能（从 shared/utils/tokenUtils 重新导出）
export {
  calculateVisionTokensForOurImages,
  estimateTextTokens,
} from '../../../../shared/utils/tokenUtils';

// 文本处理工具
export {
  isLikelyMultiColumn,
  // extractTextStatistics, // NOTE: 已废弃
  cleanTextBlock,
} from './textProcessing';

// 数据转换工具
export {
  convertTextToBlocks,
  // mergeSimilarBlocks, // NOTE: 已废弃
  // filterEmptyBlocks // NOTE: 已废弃
} from './dataConverters';

// 数学计算工具
// 🔥 已移除：这些功能已废弃或移动
// export {
//   calculateReadingOrder,
//   detectColumnBoundaries,
//   groupTextByRegion
// } from './mathUtils';

// 🔥 新增：测试和验证工具
// 测试功能已移除
