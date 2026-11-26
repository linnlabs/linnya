export interface ViewportRowGeometry {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

export interface ViewportRowAnchor {
  readonly rowKey: string;
  /** 视口顶到该行顶的距离取负；行在视口顶下方时为负数。 */
  readonly offsetFromRowStartPx: number;
}

/**
 * 列表中段有行被移除（例如本轮结束时工作过程收成一行）时，决定保持哪一行在屏幕上的位置。
 *
 * TanStack 只按“视口顶那一行”归位：顶行留下时它不动，但正在看的回答若在被移除的行下方，
 * 仍会整体上跳。所以当被移除的行有一部分在视口里时，改为锚定它们下方第一条留下的行，
 * 让正在看的回答停在原处。移除的行都不在视口里时返回 null，交给 TanStack 的默认归位。
 */
export function resolveRemovalViewportAnchor(input: {
  readonly previous: readonly ViewportRowGeometry[];
  readonly nextKeys: ReadonlySet<string>;
  readonly scrollOffset: number;
  readonly viewportHeight: number;
}): ViewportRowAnchor | null {
  const viewportEnd = input.scrollOffset + input.viewportHeight;
  let lastRemovedVisibleIndex = -1;
  input.previous.forEach((row, index) => {
    const visible = row.end > input.scrollOffset && row.start < viewportEnd;
    if (visible && !input.nextKeys.has(row.key)) lastRemovedVisibleIndex = index;
  });
  if (lastRemovedVisibleIndex < 0) return null;
  for (let index = lastRemovedVisibleIndex + 1; index < input.previous.length; index += 1) {
    const row = input.previous[index];
    if (row && input.nextKeys.has(row.key)) {
      return { rowKey: row.key, offsetFromRowStartPx: input.scrollOffset - row.start };
    }
  }
  return null;
}
