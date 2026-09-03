/**
 * DeckSpecPatchApplier 子模块共享的内部类型。
 *
 * 这一层只放纯类型，**不引入任何业务实现**——确保
 * `structuredApplier` / `freeformApplier` / `shared` / `slidePlan`
 * 之间没有反向依赖、循环依赖。
 */

import type {
  Box,
  FreeformElement,
  PatchOperation,
} from '@plugin/slides/shared';

/**
 * Freeform group 透视变换：把"局部坐标"映射回"slide 全局英寸"。
 *
 * **唯一定义来源**：`backend/engine/shared/freeformTransform.ts`。
 * 这里 re-export 仅为保持 patch 子模块内 import 路径短，**禁止在本文件
 * 重新声明结构**——两处定义会让 `apply / build` 算法漂移（详见 §5.2）。
 */
export type { FreeformTransform } from '../../shared/freeformTransform.js';
import type { FreeformTransform } from '../../shared/freeformTransform.js';

/**
 * Freeform 元素匹配结果。
 *
 * - `element`：匹配到的目标元素引用（patch 直接 mutate 它）
 * - `parent`：该元素所在的父数组（reorder 时用）
 * - `index`：该元素在 parent 中的下标
 * - `transform`：从该元素局部坐标到 slide 全局的累计透视
 * - `actualPosition`：元素在 slide 全局的实际 bbox（已应用 transform）
 */
export interface FreeformElementMatch {
  element: FreeformElement;
  parent: FreeformElement[];
  index: number;
  transform: FreeformTransform;
  actualPosition: Box;
}

/**
 * 元素级 patch operation 的子集——只包含真正"动元素"的几条；
 * `insert_slide / delete_slide / reorder_slides` 由 `slidePlan` 单独处理。
 */
export type ElementPatchOperation = Extract<
  PatchOperation,
  {
    op:
      | 'modify_text'
      | 'replace_image'
      | 'update_chart'
      | 'update_table'
      | 'modify_style'
      | 'modify_geometry'
      | 'reorder_layer';
  }
>;
