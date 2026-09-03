/**
 * Flex/Yoga 编译后供质量诊断消费的窄布局事实。
 *
 * 这是 generated-only 的内部追踪合同，不是 deck.js authoring API。它只保留
 * “作者声明”与“Yoga 最终结果”之间可验证的差异，不复制 LayoutNode 或样式树。
 */
export interface GeneratedLayoutBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly unit: 'in';
}

export interface GeneratedLayoutSourceSpan {
  readonly startLine: number;
  readonly endLine: number;
}

export interface GeneratedLayoutConstraintNode {
  readonly nodeId: string;
  readonly kind: 'slide' | 'layout_container';
  readonly label: string;
  readonly finalBox: GeneratedLayoutBox;
  readonly zIndex: -1;
  readonly parentNodeId?: string;
  readonly sourceSpan?: GeneratedLayoutSourceSpan;
}

export interface GeneratedLayoutDeclaredConstraints {
  readonly widthInches?: number;
  readonly heightInches?: number;
  readonly minWidthInches?: number;
  readonly minHeightInches?: number;
  readonly maxWidthInches?: number;
  readonly maxHeightInches?: number;
  readonly topInches?: number;
  readonly rightInches?: number;
  readonly bottomInches?: number;
  readonly leftInches?: number;
}

export interface GeneratedLayoutComputedRatios {
  readonly widthToDeclared?: number;
  readonly heightToDeclared?: number;
}

export interface GeneratedParentLayoutConstraintFacts {
  readonly positionMode: 'flow' | 'absolute';
  readonly declared: GeneratedLayoutDeclaredConstraints;
  readonly computedRatios: GeneratedLayoutComputedRatios;
  readonly parent: GeneratedLayoutConstraintNode;
}

export interface GeneratedLayoutConstraintEvidence {
  /** 原始 Flex layout node 的稳定编译期身份，用于跨 finding 关联共同根因。 */
  readonly layoutNodeId: string;
  readonly positionMode: 'flow' | 'absolute';
  readonly declared: GeneratedLayoutDeclaredConstraints;
  readonly finalBox: GeneratedLayoutBox;
  readonly computedRatios: GeneratedLayoutComputedRatios;
  readonly parent: GeneratedLayoutConstraintNode;
  /** 直接父容器自身的约束事实；让无装饰 View 也能成为可定位根因。 */
  readonly parentConstraint?: GeneratedParentLayoutConstraintFacts;
  /** 当前 Flex DSL 没有裁剪语法，后代越界在最终画面中保持可见。 */
  readonly clipSemantics: 'visible';
}
