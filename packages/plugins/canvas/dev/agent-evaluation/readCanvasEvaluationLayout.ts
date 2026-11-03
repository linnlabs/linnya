/** 仅检查验收桥自己创建的容器，不读取产品store或其他窗口。 */
export function readCanvasEvaluationLayout(root: HTMLElement | null) {
  const read = (element: Element | null) => {
    if (!element) return null;
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, position: style.position, display: style.display, cssHeight: style.height };
  };
  return { viewport: { width: innerWidth, height: innerHeight, visibility: document.visibilityState }, root: read(root), section: read(root?.firstElementChild ?? null), stage: read(root?.querySelector('.canvas-stage') ?? null) };
}
