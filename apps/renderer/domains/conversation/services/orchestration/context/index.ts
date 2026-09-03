/**
 * @file 上下文模块导出入口
 *
 * 中文说明：
 * - 统一导出 pageContext 和 structured context 相关的类型和函数
 * - 外部模块只需从此入口导入
 *
 * 具体文档类型通过 RendererPageContextProvider 插入。
 */

// pageContext
export {
  buildPageContextV1,
  buildPageContextV1WithLog,
  formatPageContextForContextBefore,
  type PageKind,
  type PageContextDocument,
  type PageContextSelection,
  type PageContextV1,
} from './pageContext';

// structuredContextRequirements
export {
  validateStructuredContextRequirements,
  type StructuredContextRequirementInput,
  type StructuredContextRequirementResult,
} from './structuredContextRequirements';
