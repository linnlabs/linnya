import type { SlideRasterPixelSize } from '@plugin/slides/shared/slideRasterization';
import {
  buildBackgroundImageConfig,
  buildBackgroundRectConfig,
  buildCellBorderConfig,
  buildCellRectConfig,
  buildCellTextNode,
  buildChartImageConfig,
  buildChartPlaceholderConfig,
  buildGroupConfig,
  buildImageGroupConfig,
  buildImageNodeConfig,
  buildImagePlaceholderConfig,
  buildInnerTextNode,
  buildShapeGroupConfig,
  buildShapeRenderInstruction,
  buildTableBackgroundConfig,
  buildTableBorderSegments,
  buildTableCellLayouts,
  buildTableGroupConfig,
  buildTextGroupConfig,
  buildTextLineConfigs,
  sortNodesByZIndex,
  type KonvaShapeRenderInstruction,
} from '../../konvaPreview';
import {
  SLIDE_BACKGROUND_IMAGE_RESOURCE_KEY,
  type LoadedRenderImage,
} from '../../renderImageResources';
import type { LoadedRenderChart } from '../../renderChartResources';
import { INCHES_TO_PX } from '../../../shared/constants';
import {
  Ellipse,
  Group,
  KonvaImage,
  Layer,
  Line,
  Path,
  Rect,
  Stage,
  Text,
} from './konvaRasterPrimitives';
import type {
  ChartRenderNode,
  GroupRenderNode,
  ImageRenderNode,
  RenderNode,
  RenderSlideSize,
  ShapeRenderNode,
  SvgGraphicRenderNode,
  MathFormulaRenderNode,
  SlideRenderModel,
  TableRenderNode,
  TextRenderNode,
} from '../../../types/render';
import {
  buildSvgGraphicGroupConfig,
  buildSvgGraphicImageConfig,
  buildSvgGraphicPlaceholderConfig,
} from '../../svgGraphicRendering';
import {
  buildFormulaGroupConfig,
  buildFormulaImageConfig,
  buildFormulaPlaceholderConfig,
} from '../../formulaRendering';
import { buildInlineFormulaImageConfigs } from '../../formulaRendering';

type KonvaGroupNode = Group;
type KonvaLeafNode =
  | Rect
  | Ellipse
  | Line
  | Path
  | Text
  | KonvaImage;
type KonvaRenderableNode = KonvaGroupNode | KonvaLeafNode;
const EMPTY_IMAGE_RESOURCES: ReadonlyMap<string, LoadedRenderImage> = new Map();

export interface CreateKonvaRasterCanvasInput {
  slide: SlideRenderModel;
  slideSize: RenderSlideSize;
  pixelSize: SlideRasterPixelSize;
  images: ReadonlyMap<string, LoadedRenderImage>;
  chartResources: ReadonlyMap<string, LoadedRenderChart>;
  transparentBackground?: boolean;
}

/**
 * 该函数是离屏栅格唯一的 Konva 实例构建入口。视觉字段只由
 * konvaPreview builders 翻译，这里只负责组装和资源生命周期。
 */
export function createKonvaRasterCanvas(
  input: CreateKonvaRasterCanvasInput,
): HTMLCanvasElement {
  const logicalWidth = input.slideSize.width * INCHES_TO_PX;
  const logicalHeight = input.slideSize.height * INCHES_TO_PX;
  const container = document.createElement('div');
  const stage = new Stage({
    container,
    width: input.pixelSize.widthPx,
    height: input.pixelSize.heightPx,
  });

  try {
    const layer = new Layer({ listening: false });
    const rootGroup = new Group({
      x: 0,
      y: 0,
      scaleX: input.pixelSize.widthPx / logicalWidth,
      scaleY: input.pixelSize.heightPx / logicalHeight,
      listening: false,
    });

    layer.add(rootGroup);
    stage.add(layer);

    if (!input.transparentBackground) {
      appendBackgroundNodes(
        rootGroup,
        input.slide,
        logicalWidth,
        logicalHeight,
        input.images,
      );
    }
    appendRenderableNodes(
      rootGroup,
      sortNodesByZIndex(input.slide.elements),
      input.images,
      input.chartResources,
    );

    return stage.toCanvas();
  } finally {
    stage.destroy();
    container.remove();
  }
}

function appendBackgroundNodes(
  parent: KonvaGroupNode,
  slide: SlideRenderModel,
  logicalWidth: number,
  logicalHeight: number,
  images: ReadonlyMap<string, LoadedRenderImage>,
): void {
  parent.add(new Rect(buildBackgroundRectConfig(slide.background, {
    width: logicalWidth,
    height: logicalHeight,
  })));

  const backgroundImage = images.get(SLIDE_BACKGROUND_IMAGE_RESOURCE_KEY);
  if (!backgroundImage) {
    return;
  }

  parent.add(new KonvaImage({
    ...buildBackgroundImageConfig(
      { width: logicalWidth, height: logicalHeight },
      backgroundImage.image,
    ),
    name: 'slide-background-image',
  }));
}

function appendRenderableNodes(
  parent: KonvaGroupNode,
  nodes: readonly RenderNode[],
  images: ReadonlyMap<string, LoadedRenderImage>,
  chartResources: ReadonlyMap<string, LoadedRenderChart>,
): void {
  for (const node of nodes) {
    if (node.visible === false) {
      continue;
    }
    parent.add(createKonvaNode(node, images, chartResources));
  }
}

function createKonvaNode(
  node: RenderNode,
  images: ReadonlyMap<string, LoadedRenderImage>,
  chartResources: ReadonlyMap<string, LoadedRenderChart>,
): KonvaRenderableNode {
  switch (node.kind) {
    case 'text':
      return createTextNode(node, images);
    case 'shape':
      return createShapeNode(node);
    case 'image':
      return createImageNode(node, images);
    case 'svgGraphic':
      return createSvgGraphicNode(node, images);
    case 'formula':
      return createFormulaNode(node, images);
    case 'table':
      return createTableNode(node);
    case 'chart':
      return createChartNode(node, chartResources);
    case 'group':
      return createGroupNode(node, images, chartResources);
  }
}

function createFormulaNode(
  node: MathFormulaRenderNode,
  images: ReadonlyMap<string, LoadedRenderImage>,
): KonvaGroupNode {
  const group = new Group(buildFormulaGroupConfig(node));
  const loadedImage = images.get(node.id);
  if (!loadedImage) {
    group.add(new Rect(buildFormulaPlaceholderConfig(node)));
    return group;
  }
  group.add(new KonvaImage(buildFormulaImageConfig(node, loadedImage)));
  return group;
}

function createSvgGraphicNode(
  node: SvgGraphicRenderNode,
  images: ReadonlyMap<string, LoadedRenderImage>,
): KonvaGroupNode {
  const group = new Group(buildSvgGraphicGroupConfig(node));
  const loadedImage = images.get(node.id);
  if (!loadedImage) {
    group.add(new Rect(buildSvgGraphicPlaceholderConfig(node)));
    return group;
  }
  group.add(new KonvaImage(buildSvgGraphicImageConfig(node, loadedImage)));
  return group;
}

function createTextNode(
  node: TextRenderNode,
  images: ReadonlyMap<string, LoadedRenderImage> = EMPTY_IMAGE_RESOURCES,
): KonvaGroupNode {
  const group = new Group(buildTextGroupConfig(node));
  for (const line of buildTextLineConfigs(node)) {
    group.add(new Text(line));
  }
  for (const formula of buildInlineFormulaImageConfigs(node, images)) {
    group.add(new KonvaImage(formula.config));
  }
  return group;
}

function createShapeNode(node: ShapeRenderNode): KonvaGroupNode {
  const group = new Group(buildShapeGroupConfig(node));
  group.add(createShapePrimitiveNode(buildShapeRenderInstruction(node)));

  if (node.innerText) {
    group.add(createTextNode(buildInnerTextNode(node)));
  }
  return group;
}

function createShapePrimitiveNode(
  instruction: KonvaShapeRenderInstruction,
): KonvaLeafNode {
  switch (instruction.primitive) {
    case 'rect':
      return new Rect(instruction.config);
    case 'ellipse':
      return new Ellipse(instruction.config);
    case 'line':
      return new Line(instruction.config);
    case 'path':
      return new Path(instruction.config);
  }
}

function createImageNode(
  node: ImageRenderNode,
  images: ReadonlyMap<string, LoadedRenderImage>,
): KonvaGroupNode {
  const group = new Group(buildImageGroupConfig(node));
  const loadedImage = images.get(node.id);
  if (!loadedImage) {
    group.add(new Rect(buildImagePlaceholderConfig(node)));
    return group;
  }

  group.add(new KonvaImage(buildImageNodeConfig(node, loadedImage)));
  return group;
}

function createTableNode(node: TableRenderNode): KonvaGroupNode {
  const group = new Group(buildTableGroupConfig(node));
  group.add(new Rect(buildTableBackgroundConfig(node)));

  for (const layout of buildTableCellLayouts(node)) {
    group.add(new Rect(buildCellRectConfig(node, layout)));
    group.add(createTextNode(buildCellTextNode(node, layout)));
  }

  for (const segment of buildTableBorderSegments(node)) {
    group.add(new Line(buildCellBorderConfig(segment)));
  }
  return group;
}

function createChartNode(
  node: ChartRenderNode,
  chartResources: ReadonlyMap<string, LoadedRenderChart>,
): KonvaRenderableNode {
  const resource = chartResources.get(node.id);
  return resource
    ? new KonvaImage(buildChartImageConfig(node, resource.image))
    : new Rect(buildChartPlaceholderConfig(node));
}

function createGroupNode(
  node: GroupRenderNode,
  images: ReadonlyMap<string, LoadedRenderImage>,
  chartResources: ReadonlyMap<string, LoadedRenderChart>,
): KonvaGroupNode {
  const group = new Group(buildGroupConfig(node));
  appendRenderableNodes(group, sortNodesByZIndex(node.children), images, chartResources);
  return group;
}
