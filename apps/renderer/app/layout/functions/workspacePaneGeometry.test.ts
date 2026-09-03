import { describe, expect, it } from 'vitest';
import {
  createInitialLayoutState,
  openDocumentInRightPaneState,
  setPreferredRightPaneWidthState,
  toggleWorkspacePanePlacementState,
  toggleWorkspaceRightPaneVisibilityState,
} from './layoutStateTransitions';
import {
  computeWorkspacePaneGeometry,
  computeWorkspacePaneGeometryFromLayoutState,
  computeWorkspacePanePlacementSwapPreferredWidth,
} from './workspacePaneGeometry';

describe('workspacePaneGeometry', () => {
  it('对话在中间时保留 360px，对右侧文档使用 480px 最小宽度', () => {
    expect(computeWorkspacePaneGeometry({
      availableWidth: 900,
      preferredRightPaneWidth: 800,
      mainPaneContent: 'conversation',
      rightPaneContent: 'document',
      rightPaneVisible: true,
    })).toEqual({
      availableWidth: 900,
      mainPaneMinWidth: 360,
      rightPaneMinWidth: 480,
      rightPaneMaxWidth: 540,
      rightPaneWidth: 540,
      rightPaneOccupiedWidth: 540,
      canOccupyRightPane: true,
    });
  });

  it('文档在中间时保留 480px，对右侧对话使用 360px 最小宽度', () => {
    const geometry = computeWorkspacePaneGeometry({
      availableWidth: 1200,
      preferredRightPaneWidth: 260,
      mainPaneContent: 'document',
      rightPaneContent: 'conversation',
      rightPaneVisible: true,
    });

    expect(geometry.rightPaneWidth).toBe(360);
    expect(geometry.rightPaneOccupiedWidth).toBe(360);
    expect(geometry.rightPaneMaxWidth).toBe(720);
  });

  it('大屏只受另一侧最小宽度限制，不施加固定最大宽度', () => {
    const geometry = computeWorkspacePaneGeometry({
      availableWidth: 3200,
      preferredRightPaneWidth: 1800,
      mainPaneContent: 'conversation',
      rightPaneContent: 'document',
      rightPaneVisible: true,
    });

    expect(geometry.rightPaneWidth).toBe(1800);
    expect(geometry.rightPaneMaxWidth).toBe(2840);
  });

  it('窗口放不下两个最小 pane 时只暂停右侧占位', () => {
    const geometry = computeWorkspacePaneGeometry({
      availableWidth: 800,
      preferredRightPaneWidth: 600,
      mainPaneContent: 'conversation',
      rightPaneContent: 'document',
      rightPaneVisible: true,
    });

    expect(geometry.canOccupyRightPane).toBe(false);
    expect(geometry.rightPaneWidth).toBe(480);
    expect(geometry.rightPaneOccupiedWidth).toBe(0);
  });

  it('用户主动收起时保留右侧内容宽度但不占布局空间', () => {
    const geometry = computeWorkspacePaneGeometry({
      availableWidth: 1400,
      preferredRightPaneWidth: 720,
      mainPaneContent: 'conversation',
      rightPaneContent: 'document',
      rightPaneVisible: false,
    });

    expect(geometry.rightPaneWidth).toBe(720);
    expect(geometry.rightPaneOccupiedWidth).toBe(0);
  });

  it('交换内容位置时同时交换两侧实际宽度', () => {
    const initial = setPreferredRightPaneWidthState(
      openDocumentInRightPaneState(createInitialLayoutState(), {
        type: 'editor',
        id: 'doc-1',
        projectId: 'project-1',
      }),
      880,
    );

    const swappedRightPaneWidth = computeWorkspacePanePlacementSwapPreferredWidth(initial, 1400);
    expect(swappedRightPaneWidth).toBe(520);

    const swapped = setPreferredRightPaneWidthState(
      toggleWorkspacePanePlacementState(initial),
      swappedRightPaneWidth,
    );
    const swappedGeometry = computeWorkspacePaneGeometryFromLayoutState(swapped, 1400);

    expect(swappedGeometry.rightPaneWidth).toBe(520);
    expect(swappedGeometry.availableWidth - swappedGeometry.rightPaneWidth).toBe(880);

    const restoredRightPaneWidth = computeWorkspacePanePlacementSwapPreferredWidth(swapped, 1400);
    const restored = setPreferredRightPaneWidthState(
      toggleWorkspacePanePlacementState(swapped),
      restoredRightPaneWidth,
    );
    const restoredGeometry = computeWorkspacePaneGeometryFromLayoutState(restored, 1400);

    expect(restoredRightPaneWidth).toBe(880);
    expect(restoredGeometry.rightPaneWidth).toBe(880);
    expect(restoredGeometry.availableWidth - restoredGeometry.rightPaneWidth).toBe(520);
  });

  it('右侧未占位时交换不改写已保存的分割宽度', () => {
    const initial = toggleWorkspaceRightPaneVisibilityState(
      setPreferredRightPaneWidthState(
        openDocumentInRightPaneState(createInitialLayoutState(), {
          type: 'editor',
          id: 'doc-1',
          projectId: 'project-1',
        }),
        720,
      ),
    );

    expect(computeWorkspacePanePlacementSwapPreferredWidth(initial, 1400)).toBe(720);
  });
});
