/** 标题截断时至少露出的宽度（字号的倍数），约两个字加省略号；再窄就认不出是什么。 */
export const HEADER_TEXT_MIN_EM = 3;
/** macOS 三个标准窗口按钮：各 14px 宽、中心距 20px，从按钮位置的 x 起共 54px。 */
export const MAC_TRAFFIC_LIGHTS_WIDTH = 54;

const EPSILON = 0.5;

function intersection(a, b) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > EPSILON && height > EPSILON ? { width: round(width), height: round(height) } : null;
}

const round = value => Math.round(value * 10) / 10;
const span = rect => `${round(rect.left)}–${round(rect.right)}`;

/**
 * 检查一次标题栏测量。元素 group：left 固定按钮、update 更新入口、title 面包屑、right 右侧按钮；
 * dividers 是落在标题栏里的分隔线拖动热区。
 * 返回违例列表，每条写明不变量、涉及元素和像素事实，供场景按条件组报告。
 */
export function checkHeaderInvariants({ viewport, header, dividers = [], trafficLights, elements }) {
  const violations = [];
  const add = (invariant, keys, detail) => violations.push({ invariant, elements: keys, detail });

  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const [a, b] = [elements[i], elements[j]];
      const overlap = intersection(a.rect, b.rect);
      if (overlap) add('overlap', [a.key, b.key], `${a.key} ${span(a.rect)} 与 ${b.key} ${span(b.rect)} 重叠 ${overlap.width}×${overlap.height}px`);
    }
  }

  for (const element of elements) {
    const { key, rect } = element;
    for (const divider of dividers) {
      const overlap = intersection(rect, divider.rect);
      if (overlap) add('divider', [key, divider.key], `${key} ${span(rect)} 伸进${divider.key}拖动热区 ${span(divider.rect)}`);
    }
    if (rect.left < -EPSILON || rect.right > viewport.width + EPSILON || rect.top < header.top - EPSILON || rect.bottom > header.bottom + EPSILON) {
      add('bounds', [key], `${key} ${span(rect)} 超出标题栏或窗口 0–${viewport.width}`);
    }
    if (trafficLights && (element.group === 'left' || element.group === 'update')) {
      const overlap = intersection(rect, trafficLights);
      if (overlap) add('traffic-lights', [key], `${key} ${span(rect)} 压到窗口按钮 ${span(trafficLights)}`);
    }
    if (element.group !== 'title') {
      if (element.missedHits?.length) add('hit', [key], `${key} 在 x=${element.missedHits.join(',')} 被 ${element.coveredBy} 盖住`);
      if (element.appRegion !== 'no-drag') add('drag-region', [key], `${key} 处在窗口拖动区（${element.appRegion}），点击会拖窗口`);
    }
    for (const text of element.texts ?? []) {
      if (!text.truncated) continue;
      // 更新按钮要么完整显示、要么收成图标，不允许半截文字。
      if (element.group === 'update') add('text', [key], `${key} 文字“${text.content}”被截断`);
      else if (text.visibleWidth < HEADER_TEXT_MIN_EM * text.fontSize) {
        add('text', [key], `${key} 的“${text.content}”只露出 ${round(text.visibleWidth)}px（少于 ${HEADER_TEXT_MIN_EM} 个字宽）`);
      }
    }
  }
  return violations;
}

/** 由 Main 报告的窗口按钮位置推出它们占的矩形；全屏或非 macOS 时没有。 */
export function trafficLightsRect(position, header) {
  if (!position) return null;
  return { left: position.x, right: position.x + MAC_TRAFFIC_LIGHTS_WIDTH, top: header.top, bottom: header.bottom };
}
