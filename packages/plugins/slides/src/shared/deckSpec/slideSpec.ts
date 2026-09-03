/**
 * Slide DSL 类型定义
 *
 * 这是 AI PPT 生成功能的核心类型定义，定义了三层架构中 Agent 的输出格式：
 * - StructuredSlideSpec: 第一层，结构化页面（标准咨询页）
 * - FreeformSlideSpec: 第二层，自由布局页面
 * - PatchSpec: 第三层，修改已有 PPT 的操作
 */

import type {
  Box,
  ChartSeries,
  FreeformSlideSpec,
  ShapeStyle,
  StructuredSlideSpec,
  TableCell,
  TextStyle,
} from './slideElementSpec';
import type { ThemeSpec } from '../visual';
import type { SlideLayout } from './slideSize';

export type {
  Box,
  ChartSeries,
  ChartType,
  FreeformElement,
  FreeformElementBase,
  FreeformGroupElement,
  FreeformImageElement,
  FreeformShapeElement,
  FreeformSvgGraphicElement,
  FreeformFormulaElement,
  FreeformSlideSpec,
  FreeformTextElement,
  FreeformTextRun,
  FreeformFormulaTextRun,
  FreeformInlineRun,
  ImageSourceInput,
  ImageSourceRef,
  ImageVisualOptions,
  ImageVisualShadow,
  ResolvedImageAsset,
  ShapeStyle,
  SlideBackgroundGradient,
  SlideBackgroundGradientStop,
  SourceSpan,
  StructuredElement,
  StructuredSvgGraphicElement,
  StructuredFormulaElement,
  StructuredSlideSpec,
  TableCell,
  TextStyle,
} from './slideElementSpec';

// ─────────────────────────────────────────────────────────────────────────────
// 第三层：Patch 层
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patch 目标定位。
 *
 * - `slideNumber` 语义固定为 patch 前当前版本的页码（从 1 开始）
 * - 优先使用 `creationId` 精确定位
 * - `elementName` 仅作为兼容回退，也允许与 `creationId` 同时携带用于调试
 */
export type PatchTarget =
  | {
      slideNumber: number;
      creationId: string;
      elementName?: string;
    }
  | {
      slideNumber: number;
      elementName: string;
      creationId?: string;
    };

export type PatchOperation =
  | {
      op: 'modify_text';
      target: PatchTarget;
      text?: string;
      textStyle?: Partial<TextStyle>;
    }
  | {
      op: 'replace_image';
      target: PatchTarget;
      newImage: string;
    }
  | {
      op: 'update_chart';
      target: PatchTarget;
      data: {
        categories: string[];
        series: ChartSeries[];
      };
    }
  | {
      op: 'update_table';
      target: PatchTarget;
      rows: TableCell[][];
    }
  | {
      op: 'modify_style';
      target: PatchTarget;
      style: Partial<ShapeStyle>;
    }
  | {
      op: 'modify_geometry';
      target: PatchTarget;
      position: Partial<Box>;
    }
  | {
      op: 'reorder_layer';
      target: PatchTarget;
      placement: 'front' | 'back' | 'forward' | 'backward';
    }
  | {
      /**
       * 在指定位置插入新页。
       *
       * `slideNumber`（**1-indexed**，必填）= 操作完成后该新页所处的页码。
       * 与 `delete_slide.slideNumber` / `text_edit.target.slideNumber` 等所有
       * `slideNumber` 字段语义统一。例如 `slideNumber: 1` → 新页成为第 1 页，
       * 旧第 1 页起整体后移；`slideNumber: length + 1` → 追加到末尾。
       *
       * 合法范围：`[1, currentSlideCount + 1]`。超范围由 `PatchPlanBuilder` 拒绝。
       */
      op: 'insert_slide';
      slideNumber: number;
      spec: StructuredSlideSpec;
    }
  | {
      op: 'delete_slide';
      slideNumber: number;
    }
  | {
      op: 'reorder_slides';
      order: number[];
    }
  | {
      op: 'apply_master';
      slideNumber: number;
      templateId: string;
      masterName?: string;
      layoutName?: string;
    };

/**
 * 第二批 patch 能力的兼容别名。
 */
export type DeferredPatchOperation = Extract<
  PatchOperation,
  { op: 'modify_style' | 'apply_master' }
>;

export interface PatchSpec {
  type: 'patch';
  operations: PatchOperation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 统一 Deck Spec
// ─────────────────────────────────────────────────────────────────────────────

export interface SlideEntry {
  slideNumber: number;
  spec: StructuredSlideSpec | FreeformSlideSpec;
}

export interface DeckSpec {
  title: string;
  layout?: SlideLayout;
  theme?: ThemeSpec;
  slides: SlideEntry[];
}
