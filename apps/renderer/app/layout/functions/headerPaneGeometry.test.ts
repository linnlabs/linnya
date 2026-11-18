import { describe, expect, it } from 'vitest';
import {
  HEADER_LEFT_ACTIONS,
  computeHeaderLeftChromeWidth,
  computeHeaderPaneGeometry,
  computeHeaderSidebarMinWidth,
  computeHeaderUpdateEntryAvailableWidth,
  computeHeaderUpdateEntryStart,
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

  it('更新入口紧跟设置按钮，侧栏展开时只能用到分隔线热区之前', () => {
    expect(computeHeaderUpdateEntryStart({ isMac: true, isWindowMaximized: false })).toBe(174);
    expect(computeHeaderUpdateEntryStart({ isMac: false, isWindowMaximized: false })).toBe(102);

    // macOS 非全屏时侧栏最窄 202：完整的“重启更新”放不下，正好放下 24px 的图标。
    expect(computeHeaderUpdateEntryAvailableWidth({
      isMac: true,
      isWindowMaximized: false,
      sidebarOccupiedWidth: computeHeaderSidebarMinWidth({ isMac: true, isWindowMaximized: false }),
    })).toBe(HEADER_LEFT_ACTIONS.buttonSize);
    // 默认宽度 260 下仍能放下约 80px 的完整按钮。
    expect(computeHeaderUpdateEntryAvailableWidth({
      isMac: true,
      isWindowMaximized: false,
      sidebarOccupiedWidth: 260,
    })).toBe(82);
    // 侧栏收起时不限宽。
    expect(computeHeaderUpdateEntryAvailableWidth({
      isMac: true,
      isWindowMaximized: false,
      sidebarOccupiedWidth: 0,
    })).toBeNull();
  });

  it('侧栏下限放得下收成图标的更新入口和分隔线热区', () => {
    // 174 起点 + 24 图标 + 4 热区：macOS 非全屏要 202，比侧栏基础下限 200 多 2px。
    expect(computeHeaderSidebarMinWidth({ isMac: true, isWindowMaximized: false })).toBe(202);
    // 全屏或其他平台起点在 102，标题栏不额外要求。
    expect(computeHeaderSidebarMinWidth({ isMac: true, isWindowMaximized: true })).toBe(130);
    expect(computeHeaderSidebarMinWidth({ isMac: false, isWindowMaximized: false })).toBe(130);
  });

  it('侧栏收起时主 pane 让开更新入口，展开时不受它影响', () => {
    expect(computeHeaderLeftChromeWidth({ isMac: true, isWindowMaximized: false, updateEntryWidth: 80 })).toBe(266);

    expect(computeHeaderPaneGeometry({
      isMac: true,
      isWindowMaximized: false,
      sidebarOccupiedWidth: 0,
      rightPaneWidth: 0,
      updateEntryWidth: 80,
    }).mainPaneLeft).toBe(266);

    expect(computeHeaderPaneGeometry({
      isMac: true,
      isWindowMaximized: false,
      sidebarOccupiedWidth: 200,
      rightPaneWidth: 0,
      updateEntryWidth: 24,
    }).mainPaneLeft).toBe(200);
  });
});
