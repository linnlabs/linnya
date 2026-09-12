/**
 * YogaAdapter — 布局树 → Yoga 节点树 → 计算绝对坐标
 *
 * 负责将 LayoutNode 树映射为 Yoga 节点树，执行布局计算，
 * 然后从计算结果中提取每个节点的绝对坐标 (inches)。
 *
 * 单位约定：Yoga 内部使用 points (1 inch = 72 pt)，
 * 输入输出对外统一使用 inches。
 *
 * yoga-layout v3 是纯 ESM 包。Electron Main 的字节码加载链
 * 替换了 Module._compile，在 vm.Script 中未设置 importModuleDynamically，
 * 导致 CJS 模块内的 require()/import() 均无法加载 ESM 包。
 *
 * 解决方案：yogaRuntimeLoader.cjs（不编译为 bytecode）中
 * 使用 vm.compileFunction + importModuleDynamically 显式启用 ESM import：
 *   1. 入口处调用 await initYoga()（仅首次触发加载）
 *   2. helper 通过 vm.compileFunction 在主上下文中执行 import('yoga-layout/load')
 *   3. 后续所有同步调用通过模块级变量 Yoga 直接使用
 */

import type { Config as YogaConfig, Node as YogaNode, Yoga as YogaModule } from 'yoga-layout/load';
import { readYogaRuntimeLoader } from './YogaRuntimeLoaderResolver.js';

const yogaRuntimeLoader = readYogaRuntimeLoader();
let Yoga: YogaModule | null = null;

/**
 * 预初始化 Yoga 引擎。必须在首次调用 computeSlideLayout 前 await 一次。
 * 重复调用安全（幂等）。
 */
export async function initYoga(): Promise<void> {
  if (Yoga) return;
  Yoga = await yogaRuntimeLoader.loadYoga();
}

import type {
  LayoutNode,
  LayoutContainerNode,
  LayoutSlideNode,
  LayoutViewNode,
  LayoutTextNode,
  FlexProps,
  EdgeInsets,
} from './LayoutTypes.js';
import { DEFAULT_TEXT_LINE_SPACING_MULTIPLE } from '@plugin/slides/shared';
import { isContainerNode } from './LayoutTypes.js';
import { estimateTextHeight, measureIntrinsicTextBox } from './TextMeasurer.js';
import { resolveLayoutTextWrapPolicy } from './TextBoxSizing.js';
import { readLayoutTableData } from './TableLayoutInput.js';
import { resolveGeneratedTableLayout } from '../../../engine/table';
import {
  readAbsolutePositionBox,
  resolveLayoutPositionMode,
} from './LayoutConstraintFacts.js';

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const PT_PER_INCH = 72;

/** 将 inches 转为 points */
function toPt(inches: number): number {
  return inches * PT_PER_INCH;
}

/** 将 points 转为 inches */
function toIn(points: number): number {
  return points / PT_PER_INCH;
}

// ─── 计算结果 ──────────────────────────────────────────────────────────────────

/** 节点的计算后绝对坐标 (inches) */
export interface ComputedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 布局计算结果：每个 LayoutNode 的绝对坐标 */
export interface LayoutResult {
  /** 该节点对应的原始 LayoutNode */
  node: LayoutNode;
  /** 计算后的绝对坐标 (inches)，相对于 Slide 左上角 */
  box: ComputedBox;
  /** 子节点的计算结果（仅容器节点有） */
  children: LayoutResult[];
}

// ─── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 对一个 Slide 的布局树执行 Yoga 布局计算。
 *
 * @param slideNode  Slide 根节点
 * @param slideWidth  画布宽度 (inches)
 * @param slideHeight 画布高度 (inches)
 * @returns 整棵树的布局结果
 */
export function computeSlideLayout(
  slideNode: LayoutSlideNode,
  slideWidth: number,
  slideHeight: number,
): LayoutResult {
  const yoga = Yoga;
  if (!yoga) {
    throw new Error('Yoga 引擎未初始化。请先在入口处调用 await initYoga()。');
  }
  const config = yoga.Config.create();
  config.setUseWebDefaults(true);
  // 禁用 Yoga 默认的 1pt 精度舍入，避免极小尺寸（如 0.005" = 0.36pt）被舍为 0
  config.setPointScaleFactor(0);

  try {
    const rootYoga = createYogaNode(yoga, config, slideNode, slideWidth, slideHeight, true);
    rootYoga.calculateLayout(toPt(slideWidth), toPt(slideHeight), yoga.DIRECTION_LTR);
    const result = collectResults(slideNode, rootYoga, 0, 0);
    rootYoga.freeRecursive();
    return result;
  } finally {
    config.free();
  }
}

// ─── Yoga 节点创建 ────────────────────────────────────────────────────────────

/**
 * 递归创建 Yoga 节点树。
 */
function createYogaNode(
  yoga: YogaModule,
  config: YogaConfig,
  node: LayoutNode,
  parentWidth: number,
  parentHeight: number,
  isRoot: boolean,
  parentDirection: 'row' | 'column' = 'column',
): YogaNode {
  const yogaNode = yoga.Node.create(config);

  // Slide 根节点：默认 column 布局，铺满画布
  if (isRoot) {
    yogaNode.setWidth(toPt(parentWidth));
    yogaNode.setHeight(toPt(parentHeight));
    yogaNode.setFlexDirection(yoga.FLEX_DIRECTION_COLUMN);
  }

  applyFlexProps(yoga, yogaNode, node, isRoot, parentDirection);

  if (isContainerNode(node)) {
    applyContainerProps(yoga, yogaNode, node as LayoutContainerNode);

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childYoga = createYogaNode(yoga, config, child, parentWidth, parentHeight, false,
        node._type === 'View' && node.flexDirection === 'row' ? 'row' : 'column');
      yogaNode.insertChild(childYoga, i);
    }
  } else if (node._type === 'Text') {
    applyTextMeasure(yoga, yogaNode, node as LayoutTextNode);
  } else if (node._type === 'Table') {
    const data = readLayoutTableData(node);
    const intrinsic = resolveGeneratedTableLayout(data);
    yogaNode.setMeasureFunc((widthPt, widthMode) => {
      const width = widthMode === yoga.MEASURE_MODE_UNDEFINED
        ? intrinsic.width
        : widthMode === yoga.MEASURE_MODE_EXACTLY
          ? toIn(widthPt)
          : Math.min(intrinsic.width, toIn(widthPt));
      const layout = resolveGeneratedTableLayout({ ...data, width });
      return { width: toPt(width), height: toPt(layout.height) };
    });
  }
  // Shape / Chart / Image / Spacer: 由 flex/width/height 控制尺寸

  return yogaNode;
}

// ─── Flex 属性映射 ────────────────────────────────────────────────────────────

function applyFlexProps(
  yoga: YogaModule,
  yogaNode: YogaNode,
  node: LayoutNode,
  isRoot: boolean,
  parentDirection: 'row' | 'column',
): void {
  const props: FlexProps = node;

  // 数值 flex 使用零 basis，正文不再以整行宽度挤压固定标签。
  if (props.flex != null && props.flex > 0) {
    yogaNode.setFlexGrow(props.flex);
    yogaNode.setFlexShrink(1);
    yogaNode.setFlexBasis(0);
  }

  // width / height（不覆盖根节点的固定尺寸）
  // 同时支持 PPTX 风格短名 w / h（width / height 优先）。
  const positionBox = readAbsolutePositionBox(props.position);
  const mainSize = parentDirection === 'row'
    ? props.width ?? props.w ?? positionBox?.w
    : props.height ?? props.h ?? positionBox?.h;
  // shrink 作用于父容器主轴，不能因为交叉轴声明尺寸而禁用正文收缩。
  if (props.flex == null && mainSize != null) yogaNode.setFlexShrink(0);
  if (!isRoot) {
    applyDimension(yogaNode, 'width', props.width ?? props.w ?? positionBox?.w);
    applyDimension(yogaNode, 'height', props.height ?? props.h ?? positionBox?.h);
  }

  // min/max 尺寸
  if (props.minWidth != null) yogaNode.setMinWidth(toPt(props.minWidth));
  if (props.minHeight != null) yogaNode.setMinHeight(toPt(props.minHeight));
  if (props.maxWidth != null) yogaNode.setMaxWidth(toPt(props.maxWidth));
  if (props.maxHeight != null) yogaNode.setMaxHeight(toPt(props.maxHeight));

  // margin
  applyEdgeValues(yoga, yogaNode, 'margin', props.margin, props);

  // position: absolute
  // x/y 是 left/top 的别名，显式设置的 left/top 优先。
  // position: {x,y,w,h} 是 PPTX/Canvas 风格兼容写法，也隐式视为 absolute。
  // 若未显式声明 position，但出现任一坐标边字段，也隐式视为 absolute。
  if (resolveLayoutPositionMode(props) === 'absolute') {
    yogaNode.setPositionType(yoga.POSITION_TYPE_ABSOLUTE);
    const resolvedTop = props.top ?? props.y ?? positionBox?.y;
    const resolvedLeft = props.left ?? props.x ?? positionBox?.x;
    if (resolvedTop != null) yogaNode.setPosition(yoga.EDGE_TOP, toPt(resolvedTop));
    if (props.right != null) yogaNode.setPosition(yoga.EDGE_RIGHT, toPt(props.right));
    if (props.bottom != null) yogaNode.setPosition(yoga.EDGE_BOTTOM, toPt(props.bottom));
    if (resolvedLeft != null) yogaNode.setPosition(yoga.EDGE_LEFT, toPt(resolvedLeft));
  }
}

function applyContainerProps(
  yoga: YogaModule,
  yogaNode: YogaNode,
  node: LayoutContainerNode,
): void {
  // flex-direction：Slide 默认 column，View 根据 flexDirection 属性决定
  if (node._type === 'Slide') {
    yogaNode.setFlexDirection(yoga.FLEX_DIRECTION_COLUMN);
  } else if (node._type === 'View') {
    const dir = (node as LayoutViewNode).flexDirection;
    yogaNode.setFlexDirection(
      dir === 'row' ? yoga.FLEX_DIRECTION_ROW : yoga.FLEX_DIRECTION_COLUMN,
    );
  }

  // padding（View 显式声明 padding 接口，Slide 也需支持）
  const paddingProp = 'padding' in node ? (node as { padding?: number | EdgeInsets }).padding : undefined;
  if (paddingProp != null) {
    if (typeof paddingProp === 'number') {
      yogaNode.setPadding(yoga.EDGE_ALL, toPt(paddingProp));
    } else {
      if (paddingProp.top != null) yogaNode.setPadding(yoga.EDGE_TOP, toPt(paddingProp.top));
      if (paddingProp.right != null) yogaNode.setPadding(yoga.EDGE_RIGHT, toPt(paddingProp.right));
      if (paddingProp.bottom != null) yogaNode.setPadding(yoga.EDGE_BOTTOM, toPt(paddingProp.bottom));
      if (paddingProp.left != null) yogaNode.setPadding(yoga.EDGE_LEFT, toPt(paddingProp.left));
    }
  }

  // gap
  const gapProp = 'gap' in node ? (node as { gap?: number }).gap : undefined;
  if (gapProp != null) {
    yogaNode.setGap(yoga.GUTTER_ALL, toPt(gapProp));
  }

  // alignItems
  const alignProp = 'alignItems' in node ? (node as { alignItems?: string }).alignItems : undefined;
  if (alignProp) {
    yogaNode.setAlignItems(mapAlignItems(yoga, alignProp));
  }

  // justifyContent
  const justifyProp = 'justifyContent' in node ? (node as { justifyContent?: string }).justifyContent : undefined;
  if (justifyProp) {
    yogaNode.setJustifyContent(mapJustifyContent(yoga, justifyProp));
  }
}

// ─── Text 节点的 measureFunc ──────────────────────────────────────────────────

function applyTextMeasure(
  yoga: YogaModule,
  yogaNode: YogaNode,
  node: LayoutTextNode,
): void {
  // 如果已经显式设了 width + height（含 w/h 别名），不需要 measureFunc
  const explicitWidth = node.width ?? node.w;
  const explicitHeight = node.height ?? node.h;
  if (explicitWidth != null && explicitHeight != null) return;

  if (resolveLayoutTextWrapPolicy(node) === 'none') {
    const intrinsicSize = measureIntrinsicTextBox(node);
    yogaNode.setWidth(toPt(intrinsicSize.widthInches));
    if (explicitHeight == null) {
      yogaNode.setHeight(toPt(intrinsicSize.heightInches));
    }
    return;
  }

  const fontSize = node.fontSize ?? 10;
  // 新属性名 lineHeight 优先，向后兼容 lineSpacing
  const lineSpacing = node.lineHeight ?? node.lineSpacing ?? DEFAULT_TEXT_LINE_SPACING_MULTIPLE;
  // 富文本数组展平为纯字符串用于高度测量
  const content = typeof node.content === 'string'
    ? node.content
    : Array.isArray(node.content)
      ? node.content.map((run) => 'text' in run ? run.text : '').join('')
      : '';

  const intrinsicSize = measureIntrinsicTextBox(node);
  yogaNode.setMeasureFunc((widthPt, widthMode, _heightPt, _heightMode) => {
    const availWidth = widthMode === yoga.MEASURE_MODE_UNDEFINED
      ? intrinsicSize.widthInches
      : widthMode === yoga.MEASURE_MODE_EXACTLY
        ? toIn(widthPt)
        : Math.min(intrinsicSize.widthInches, toIn(widthPt));

    const estHeight = estimateTextHeight(content, availWidth, fontSize, lineSpacing, node.letterSpacing);
    return {
      width: toPt(availWidth),
      height: toPt(estHeight),
    };
  });
}

// ─── 结果收集 ──────────────────────────────────────────────────────────────────

/**
 * 递归收集 Yoga 计算结果。
 * parentAbsX / parentAbsY 用于将相对坐标转为 Slide 绝对坐标。
 */
function collectResults(
  node: LayoutNode,
  yogaNode: YogaNode,
  parentAbsX: number,
  parentAbsY: number,
): LayoutResult {
  const relX = toIn(yogaNode.getComputedLeft());
  const relY = toIn(yogaNode.getComputedTop());
  const w = toIn(yogaNode.getComputedWidth());
  const h = toIn(yogaNode.getComputedHeight());

  const absX = parentAbsX + relX;
  const absY = parentAbsY + relY;

  const children: LayoutResult[] = [];

  if (isContainerNode(node)) {
    for (let i = 0; i < node.children.length; i++) {
      const childYoga = yogaNode.getChild(i);
      children.push(collectResults(node.children[i], childYoga, absX, absY));
    }
  }

  return {
    node,
    box: { x: absX, y: absY, w, h },
    children,
  };
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function applyDimension(
  yogaNode: YogaNode,
  prop: 'width' | 'height',
  value: number | string | undefined,
): void {
  if (value == null) return;

  if (typeof value === 'string') {
    const pctMatch = value.match(/^(\d+(?:\.\d+)?)%$/);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      if (prop === 'width') yogaNode.setWidthPercent(pct);
      else yogaNode.setHeightPercent(pct);
      return;
    }
    // 尝试解析为数字 (inches)
    const num = parseFloat(value);
    if (Number.isFinite(num)) {
      if (prop === 'width') yogaNode.setWidth(toPt(num));
      else yogaNode.setHeight(toPt(num));
    }
    return;
  }

  // 数字 (inches)
  if (prop === 'width') yogaNode.setWidth(toPt(value));
  else yogaNode.setHeight(toPt(value));
}

function applyEdgeValues(
  yoga: YogaModule,
  yogaNode: YogaNode,
  prop: 'margin',
  value: number | EdgeInsets | undefined,
  shortcuts: FlexProps,
): void {
  if (value != null) {
    if (typeof value === 'number') {
      yogaNode.setMargin(yoga.EDGE_ALL, toPt(value));
    } else {
      if (value.top != null) yogaNode.setMargin(yoga.EDGE_TOP, toPt(value.top));
      if (value.right != null) yogaNode.setMargin(yoga.EDGE_RIGHT, toPt(value.right));
      if (value.bottom != null) yogaNode.setMargin(yoga.EDGE_BOTTOM, toPt(value.bottom));
      if (value.left != null) yogaNode.setMargin(yoga.EDGE_LEFT, toPt(value.left));
    }
  }

  // marginTop/Bottom/Left/Right 快捷方式覆盖
  if (shortcuts.marginTop != null) yogaNode.setMargin(yoga.EDGE_TOP, toPt(shortcuts.marginTop));
  if (shortcuts.marginBottom != null) yogaNode.setMargin(yoga.EDGE_BOTTOM, toPt(shortcuts.marginBottom));
  if (shortcuts.marginLeft != null) yogaNode.setMargin(yoga.EDGE_LEFT, toPt(shortcuts.marginLeft));
  if (shortcuts.marginRight != null) yogaNode.setMargin(yoga.EDGE_RIGHT, toPt(shortcuts.marginRight));
}

function mapAlignItems(yoga: YogaModule, value: string): number {
  switch (value) {
    case 'flex-start': return yoga.ALIGN_FLEX_START;
    case 'center': return yoga.ALIGN_CENTER;
    case 'flex-end': return yoga.ALIGN_FLEX_END;
    case 'stretch': return yoga.ALIGN_STRETCH;
    default: return yoga.ALIGN_STRETCH;
  }
}

function mapJustifyContent(yoga: YogaModule, value: string): number {
  switch (value) {
    case 'flex-start': return yoga.JUSTIFY_FLEX_START;
    case 'center': return yoga.JUSTIFY_CENTER;
    case 'flex-end': return yoga.JUSTIFY_FLEX_END;
    case 'space-between': return yoga.JUSTIFY_SPACE_BETWEEN;
    case 'space-around': return yoga.JUSTIFY_SPACE_AROUND;
    default: return yoga.JUSTIFY_FLEX_START;
  }
}
