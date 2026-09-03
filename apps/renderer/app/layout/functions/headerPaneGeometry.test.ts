import { describe, expect, it } from 'vitest';
import {
  computeHeaderLeftChromeWidth,
  computeHeaderPaneGeometry,
  computeWindowsControlWidth,
} from './headerPaneGeometry';

describe('headerPaneGeometry', () => {
  it('为 Windows 自定义窗口按钮预留右侧宽度', () => {
    expect(computeWindowsControlWidth(false)).toBe(138);
    expect(computeWindowsControlWidth(true)).toBe(0);
  });

  it('左侧 chrome 宽度跟随 Mac 原生窗口按钮占位', () => {
    expect(computeHeaderLeftChromeWidth({ isMac: true, isWindowMaximized: false })).toBe(178);
    expect(computeHeaderLeftChromeWidth({ isMac: true, isWindowMaximized: true })).toBe(106);
    expect(computeHeaderLeftChromeWidth({ isMac: false, isWindowMaximized: false })).toBe(106);
  });

  it('主 pane 左边界取左侧栏占位和 header chrome 的较大值', () => {
    expect(
      computeHeaderPaneGeometry({
        isMac: true,
        isWindowMaximized: false,
        sidebarOccupiedWidth: 320,
        rightPaneWidth: 512,
      }),
    ).toEqual({
      mainPaneLeft: 320,
      mainPaneRight: 512,
      rightPaneRight: 0,
      rightPaneWidth: 512,
      trailingChromeWidth: 0,
    });

    expect(
      computeHeaderPaneGeometry({
        isMac: false,
        isWindowMaximized: false,
        sidebarOccupiedWidth: 64,
        rightPaneWidth: 480,
      }),
    ).toEqual({
      mainPaneLeft: 106,
      mainPaneRight: 480,
      rightPaneRight: 0,
      rightPaneWidth: 480,
      trailingChromeWidth: 138,
    });
  });

  it('Windows 涓嬫病鏈夊彸 pane 鏃讹紝涓?pane 浠嶉渶瑕侀伩寮€绐楀彛鎸夐挳', () => {
    expect(
      computeHeaderPaneGeometry({
        isMac: false,
        isWindowMaximized: false,
        sidebarOccupiedWidth: 64,
        rightPaneWidth: 0,
      }),
    ).toEqual({
      mainPaneLeft: 106,
      mainPaneRight: 138,
      rightPaneRight: 0,
      rightPaneWidth: 0,
      trailingChromeWidth: 138,
    });
  });
});
