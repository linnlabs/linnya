import type {
  DeckSpec,
  FreeformElement,
  FreeformInlineRun,
  FreeformSlideSpec,
  ImageVisualShadow,
  ShapeStyle,
  SlideBackgroundGradient,
  StructuredElement,
  StructuredSlideSpec,
  TableCell,
  TextStyle,
} from '../deckSpec';
import type { ThemeSpec } from './themeSpec';
import type { GradientPaint, Paint, ShapeStrokeStyle } from './paint';
import {
  normalizeGradientPaint,
  normalizePaint,
  normalizeShapeFillInput,
  normalizeStrokePaint,
} from './paint';
import {
  resolveThemeChartPalette,
  type ThemeChartPalette,
} from './themeChart';
import {
  failure,
  normalizeFillColor,
  normalizeOpaqueColor,
  normalizeShadowColor,
  success,
  type NormalizeResult,
} from './colorPrimitives';

export {
  assertCanonicalHexColor,
  normalizeFillColor,
  normalizeOpaqueColor,
  normalizeShadowColor,
  toPptxHexColor,
} from './colorPrimitives';

export function normalizeTextStyleColors(style: TextStyle, path: string): NormalizeResult<TextStyle> {
  const normalized: TextStyle = { ...style };
  if (style.color) {
    const colorResult = normalizeOpaqueColor(style.color, `${path}.color`);
    if ('error' in colorResult) {
      return colorResult;
    }
    normalized.color = colorResult.value;
  }
  return success(normalized);
}

export function normalizeChartStyleColors(
  style: NonNullable<Extract<StructuredElement, { type: 'chart' }>['chartStyle']>,
  path: string,
): NormalizeResult<typeof style> {
  const normalized = { ...style };
  for (const key of [
    'axisLabelColor',
    'categoryAxisLabelColor',
    'valueAxisLabelColor',
    'dataLabelColor',
    'gridlineColor',
  ] as const) {
    const color = style[key];
    if (color == null) continue;
    const result = normalizeOpaqueColor(color, `${path}.${key}`);
    if ('error' in result) return result;
    normalized[key] = result.value;
  }
  return success(normalized);
}

export function normalizeShapeStrokeColors(
  border: ShapeStrokeStyle,
  path: string,
): NormalizeResult<ShapeStrokeStyle> {
  if (!Number.isFinite(border.width) || border.width <= 0) {
    return failure(`${path}.width 必须是大于 0 的有限数字。`);
  }
  if (border.paint != null && border.color != null) {
    return failure(`${path} 不能同时提供 color 与 paint。`);
  }
  if (border.paint != null) {
    const result = normalizeStrokePaint(border.paint, `${path}.paint`);
    if ('error' in result) return result;
    return success({
      width: border.width,
      dash: border.dash,
      paint: result.value,
    });
  }
  if (border.color == null) {
    return failure(`${path} 必须提供 color 或 paint。`);
  }
  const result = normalizeOpaqueColor(border.color, `${path}.color`);
  if ('error' in result) return result;
  return success({
    width: border.width,
    dash: border.dash,
    paint: { type: 'solid', color: result.value },
  });
}

export function normalizeGradientColors(
  gradient: SlideBackgroundGradient,
  path: string,
): NormalizeResult<SlideBackgroundGradient> {
  return normalizeGradientPaint(gradient, path);
}

export function normalizeShapeStyleColors(
  style: Partial<ShapeStyle>,
  path: string,
): NormalizeResult<Partial<ShapeStyle>> {
  const normalized: Partial<ShapeStyle> = { ...style };

  const legacyFillCount = Number(style.fill != null) + Number(style.gradient != null);
  if (style.paint != null && legacyFillCount > 0) {
    return failure(`${path} 不能同时提供 paint 与旧 fill/gradient 字段。`);
  }

  let paint: Paint | undefined;
  if (style.paint != null) {
    const paintResult = normalizePaint(style.paint, `${path}.paint`);
    if ('error' in paintResult) return paintResult;
    paint = paintResult.value;
  } else if (style.gradient != null) {
    // 历史 DeckSpec 会同时保存 fill 作为静态 fallback 和 gradient 作为真实视觉；
    // admission 只在此处迁移，当前 Flex 合同不会再产出双字段。
    const gradientResult = normalizeGradientPaint(style.gradient, `${path}.gradient`);
    if ('error' in gradientResult) return gradientResult;
    paint = gradientResult.value;
  } else if (style.fill != null) {
    const fillResult = normalizeShapeFillInput(style.fill, `${path}.fill`);
    if ('error' in fillResult) return fillResult;
    paint = fillResult.value;
  }
  normalized.paint = paint;
  delete normalized.fill;
  delete normalized.gradient;

  if (style.border) {
    const borderResult = normalizeShapeStrokeColors(style.border, `${path}.border`);
    if ('error' in borderResult) return borderResult;
    normalized.border = borderResult.value;
  }

  if (style.shadow) {
    const shadowResult = normalizeShadowColor(style.shadow.color, `${path}.shadow.color`, style.shadow.opacity);
    if ('error' in shadowResult) {
      return shadowResult;
    }
    normalized.shadow = {
      ...style.shadow,
      color: shadowResult.value.color,
      opacity: shadowResult.value.opacity,
    };
  }

  return success(normalized);
}

function normalizeBackgroundPaint<T extends {
  paint?: Paint;
  color?: string;
  gradient?: GradientPaint;
  image?: unknown;
}>(background: T, path: string): NormalizeResult<T> {
  const legacyPaintCount = Number(background.color != null) + Number(background.gradient != null);
  if (background.paint != null && legacyPaintCount > 0) {
    return failure(`${path} 不能同时提供 paint 与旧 color/gradient 字段。`);
  }
  if (background.image != null && (background.paint != null || background.gradient != null)) {
    return failure(`${path} 的 image 与 gradient/paint 互斥。`);
  }
  if (background.image != null) {
    // 历史 DeckSpec 允许图片带 color fallback；图片才是真实视觉，迁移后移除 fallback。
    const normalized = { ...background, paint: undefined };
    delete normalized.color;
    delete normalized.gradient;
    return success(normalized);
  }

  let paint: Paint | undefined;
  if (background.paint != null) {
    const result = normalizePaint(background.paint, `${path}.paint`);
    if ('error' in result) return result;
    paint = result.value;
  } else if (background.gradient != null) {
    // 与 ShapeStyle 相同：旧版本的 color 是 gradient 静态 fallback，迁移后删除。
    const result = normalizeGradientPaint(background.gradient, `${path}.gradient`);
    if ('error' in result) return result;
    paint = result.value;
  } else if (background.color != null) {
    const result = normalizeShapeFillInput(background.color, `${path}.color`);
    if ('error' in result) return result;
    paint = result.value;
  }

  const normalized = { ...background, paint };
  delete normalized.color;
  delete normalized.gradient;
  return success(normalized);
}

export function normalizeImageShadowColors(
  shadow: ImageVisualShadow,
  path: string,
): NormalizeResult<ImageVisualShadow> {
  const normalized: ImageVisualShadow = { ...shadow };
  if (shadow.color) {
    const colorResult = normalizeShadowColor(shadow.color, `${path}.color`, shadow.opacity);
    if ('error' in colorResult) {
      return colorResult;
    }
    normalized.color = colorResult.value.color;
    normalized.opacity = colorResult.value.opacity;
  }
  return success(normalized);
}

export function normalizeThemeSpecColors(theme: ThemeSpec, path = 'theme'): NormalizeResult<ThemeSpec> {
  const normalized: ThemeSpec = { ...theme };

  if (theme.colors) {
    const colors: Record<string, string> = {};
    for (const [key, color] of Object.entries(theme.colors)) {
      const colorResult = normalizeOpaqueColor(color, `${path}.colors.${key}`);
      if ('error' in colorResult) {
        return colorResult;
      }
      colors[key] = colorResult.value;
    }
    normalized.colors = colors;
  }

  if (theme.chart?.palette) {
    const palette: string[] = [];
    for (let index = 0; index < theme.chart.palette.length; index++) {
      const colorResult = normalizeOpaqueColor(theme.chart.palette[index], `${path}.chart.palette[${index}]`);
      if ('error' in colorResult) {
        return colorResult;
      }
      palette.push(colorResult.value);
    }
    // ThemeChartPalette 为非空元组 [string, ...string[]]，与 string[] 不兼容；空数组时从已归一化的 colors 推导合法调色板
    let paletteResolved: ThemeChartPalette;
    if (palette.length === 0) {
      paletteResolved = resolveThemeChartPalette({ colors: normalized.colors, chart: undefined });
    } else {
      const [first, ...rest] = palette;
      paletteResolved =
        first !== undefined ? [first, ...rest] : resolveThemeChartPalette({ colors: normalized.colors, chart: undefined });
    }
    normalized.chart = {
      ...theme.chart,
      palette: paletteResolved,
    };
  }

  return success(normalized);
}

function normalizeTableCellColors(cell: TableCell, path: string): NormalizeResult<TableCell> {
  const normalized: TableCell = { ...cell };
  if (cell.style) {
    const styleResult = normalizeTextStyleColors(cell.style, `${path}.style`);
    if ('error' in styleResult) {
      return styleResult;
    }
    normalized.style = styleResult.value;
  }
  if (cell.fill) {
    const fillResult = normalizeOpaqueColor(cell.fill, `${path}.fill`);
    if ('error' in fillResult) {
      return fillResult;
    }
    normalized.fill = fillResult.value;
  }
  return success(normalized);
}

function normalizeStructuredElementColors(
  element: StructuredElement,
  path: string,
): NormalizeResult<StructuredElement> {
  switch (element.type) {
    case 'title':
    case 'text':
    case 'bulletList':
    case 'numberedList': {
      if (!element.style) {
        return success(element);
      }
      const styleResult = normalizeTextStyleColors(element.style, `${path}.style`);
      if ('error' in styleResult) {
        return styleResult;
      }
      return success({
        ...element,
        style: styleResult.value,
      });
    }
    case 'shape': {
      if (!element.style) {
        return success(element);
      }
      const styleResult = normalizeShapeStyleColors(element.style, `${path}.style`);
      if ('error' in styleResult) {
        return styleResult;
      }
      return success({
        ...element,
        style: styleResult.value,
      });
    }
    case 'table': {
      const borderResult = element.border
        ? normalizeShapeStrokeColors(element.border, `${path}.border`)
        : success(undefined);
      if ('error' in borderResult) return borderResult;
      const rows: TableCell[][] = [];
      for (let rowIndex = 0; rowIndex < element.rows.length; rowIndex++) {
        const row: TableCell[] = [];
        for (let cellIndex = 0; cellIndex < element.rows[rowIndex].length; cellIndex++) {
          const cellResult = normalizeTableCellColors(
            element.rows[rowIndex][cellIndex],
            `${path}.rows[${rowIndex}][${cellIndex}]`,
          );
          if ('error' in cellResult) {
            return cellResult;
          }
          row.push(cellResult.value);
        }
        rows.push(row);
      }
      return success({
        ...element,
        rows,
        ...(borderResult.value ? { border: borderResult.value } : {}),
      });
    }
    case 'image': {
      if (!element.shadow) {
        return success(element);
      }
      const shadowResult = normalizeImageShadowColors(element.shadow, `${path}.shadow`);
      if ('error' in shadowResult) {
        return shadowResult;
      }
      return success({
        ...element,
        shadow: shadowResult.value,
      });
    }
    case 'chart': {
      if (!element.chartStyle) return success(element);
      const chartStyleResult = normalizeChartStyleColors(element.chartStyle, `${path}.chartStyle`);
      if ('error' in chartStyleResult) return chartStyleResult;
      return success({ ...element, chartStyle: chartStyleResult.value });
    }
    case 'svgGraphic':
      return success(element);
    case 'formula': {
      const colorResult = normalizeOpaqueColor(element.source.color, `${path}.source.color`);
      if ('error' in colorResult) return colorResult;
      return success({
        ...element,
        source: { ...element.source, color: colorResult.value },
      });
    }
  }
}

function normalizeFreeformElementStyle(
  style: FreeformElement['style'],
  path: string,
): NormalizeResult<FreeformElement['style']> {
  if (!style) {
    return success(style);
  }
  const textStyleResult = normalizeTextStyleColors(style, path);
  if ('error' in textStyleResult) {
    return textStyleResult;
  }
  const shapeStyleResult = normalizeShapeStyleColors(style, path);
  if ('error' in shapeStyleResult) {
    return shapeStyleResult;
  }
  return success({
    ...textStyleResult.value,
    ...shapeStyleResult.value,
  });
}

function normalizeFreeformElementColors(
  element: FreeformElement,
  path: string,
): NormalizeResult<FreeformElement> {
  if (element.type === 'svgGraphic') {
    return success(element);
  }
  if (element.type === 'formula') {
    const colorResult = normalizeOpaqueColor(element.source.color, `${path}.source.color`);
    if ('error' in colorResult) return colorResult;
    return success({
      ...element,
      source: { ...element.source, color: colorResult.value },
    });
  }
  const styleResult = normalizeFreeformElementStyle(element.style, `${path}.style`);
  if ('error' in styleResult) {
    return styleResult;
  }

  switch (element.type) {
    case 'text': {
      if (!Array.isArray(element.content)) {
        return success({
          ...element,
          style: styleResult.value,
        });
      }
      const runs: FreeformInlineRun[] = [];
      for (let runIndex = 0; runIndex < element.content.length; runIndex++) {
        const run = element.content[runIndex];
        if ('formula' in run) {
          const formulaColor = normalizeOpaqueColor(
            run.formula.color,
            `${path}.content[${runIndex}].formula.color`,
          );
          if ('error' in formulaColor) return formulaColor;
          runs.push({ formula: { ...run.formula, color: formulaColor.value } });
          continue;
        }
        if (!run.style) {
          runs.push(run);
          continue;
        }
        const runStyle = normalizeTextStyleColors(run.style, `${path}.content[${runIndex}].style`);
        if ('error' in runStyle) {
          return runStyle;
        }
        runs.push({
          ...run,
          style: runStyle.value,
        });
      }
      return success({
        ...element,
        style: styleResult.value,
        content: runs,
      });
    }
    case 'shape':
      return success({
        ...element,
        style: styleResult.value,
      });
    case 'image': {
      let shadow = element.shadow;
      if (element.shadow) {
        const shadowResult = normalizeImageShadowColors(element.shadow, `${path}.shadow`);
        if ('error' in shadowResult) {
          return shadowResult;
        }
        shadow = shadowResult.value;
      }
      return success({
        ...element,
        style: styleResult.value,
        shadow,
      });
    }
    case 'group': {
      // FreeformGroupElement.children 为可选；缺失时视为无子节点，输出仍保持 undefined（与空数组区分）
      const sourceChildren = element.children ?? [];
      const children: FreeformElement[] = [];
      for (let index = 0; index < sourceChildren.length; index++) {
        const childResult = normalizeFreeformElementColors(sourceChildren[index], `${path}.children[${index}]`);
        if ('error' in childResult) {
          return childResult;
        }
        children.push(childResult.value);
      }
      return success({
        ...element,
        style: styleResult.value,
        children: element.children === undefined ? undefined : children,
      });
    }
  }
}

export function normalizeStructuredSlideSpecColors(
  spec: StructuredSlideSpec,
  path: string,
): NormalizeResult<StructuredSlideSpec> {
  const normalized: StructuredSlideSpec = { ...spec };

  if (spec.background) {
    const background = normalizeBackgroundPaint(spec.background, `${path}.background`);
    if ('error' in background) return background;
    normalized.background = background.value;
  }

  const elements: StructuredElement[] = [];
  for (let index = 0; index < spec.elements.length; index++) {
    const elementResult = normalizeStructuredElementColors(spec.elements[index], `${path}.elements[${index}]`);
    if ('error' in elementResult) {
      return elementResult;
    }
    elements.push(elementResult.value);
  }
  normalized.elements = elements;

  return success(normalized);
}

export function normalizeFreeformSlideSpecColors(
  spec: FreeformSlideSpec,
  path: string,
): NormalizeResult<FreeformSlideSpec> {
  const normalized: FreeformSlideSpec = { ...spec };

  if (spec.background) {
    const background = normalizeBackgroundPaint(spec.background, `${path}.background`);
    if ('error' in background) return background;
    normalized.background = background.value;
  }

  const elements: FreeformElement[] = [];
  for (let index = 0; index < spec.elements.length; index++) {
    const elementResult = normalizeFreeformElementColors(spec.elements[index], `${path}.elements[${index}]`);
    if ('error' in elementResult) {
      return elementResult;
    }
    elements.push(elementResult.value);
  }
  normalized.elements = elements;

  return success(normalized);
}

export function normalizeDeckSpecColors(deck: DeckSpec): NormalizeResult<DeckSpec> {
  const normalized: DeckSpec = { ...deck };

  if (deck.theme) {
    const themeResult = normalizeThemeSpecColors(deck.theme);
    if ('error' in themeResult) {
      return themeResult;
    }
    normalized.theme = themeResult.value;
  }

  const slides: DeckSpec['slides'] = [];
  for (let index = 0; index < deck.slides.length; index++) {
    const slide = deck.slides[index];
    const nextSlide = { ...slide };
    const specPath = `slides[${index}].spec`;
    const specResult = slide.spec.type === 'structured'
      ? normalizeStructuredSlideSpecColors(slide.spec, specPath)
      : normalizeFreeformSlideSpecColors(slide.spec, specPath);
    if ('error' in specResult) {
      return specResult;
    }
    nextSlide.spec = specResult.value;

    slides.push(nextSlide);
  }
  normalized.slides = slides;

  return success(normalized);
}
