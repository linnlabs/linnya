import { describe, expect, it } from 'vitest';
import {
  buildTableColumnHeaderStyles,
  buildTableRowHeaderStyle,
  TABLE_COLUMN_HEADER_HEIGHT,
  TABLE_ROW_HEADER_WIDTH,
} from './tableCoordinateHeaderStyles';

describe('tableCoordinateHeaderStyles', () => {
  it('builds column header styles from measured geometry without reading DOM', () => {
    const styles = buildTableColumnHeaderStyles({
      columnWidths: [100, 120, 140],
      tableRect: { left: 30, top: 80, width: 360, height: 200 },
      scrollLeft: 45,
      containerRect: { left: 10, top: 50 },
      tableScrollContainerRect: { left: 30, top: 80 },
      visibleWidth: 240,
      hasScrollContainer: true,
    });

    expect(styles.floatingStyle).toMatchObject({
      position: 'fixed',
      left: '30px',
      top: `${80 - TABLE_COLUMN_HEADER_HEIGHT}px`,
      height: `${TABLE_COLUMN_HEADER_HEIGHT}px`,
      width: '240px',
      visibility: 'visible',
    });
    expect(styles.scrollerStyle).toEqual({
      width: '360px',
      transform: 'translateX(-45px)',
    });
  });

  it('sticks column header to the editor shell top and hides it when table is above viewport', () => {
    const styles = buildTableColumnHeaderStyles({
      columnWidths: [100],
      tableRect: { left: 30, top: 10, width: 100, height: 20 },
      scrollLeft: 0,
      containerRect: { left: 10, top: 50 },
      tableScrollContainerRect: { left: 30, top: 20 },
      visibleWidth: 0,
      hasScrollContainer: true,
    });

    expect(styles.floatingStyle.top).toBe('50px');
    expect(styles.floatingStyle.visibility).toBe('hidden');
  });

  it('hides column header when table scroll container is not bound yet', () => {
    const styles = buildTableColumnHeaderStyles({
      columnWidths: [100],
      tableRect: { left: 0, top: 0, width: 100, height: 100 },
      scrollLeft: 0,
      containerRect: { left: 0, top: 0 },
      tableScrollContainerRect: { left: 0, top: 0 },
      visibleWidth: 0,
      hasScrollContainer: false,
    });

    expect(styles.floatingStyle).toEqual({ visibility: 'hidden' });
    expect(styles.scrollerStyle).toEqual({});
  });

  it('builds row header style and clamps height at editor shell bottom', () => {
    const style = buildTableRowHeaderStyle({
      tableRect: { left: 30, top: 80, width: 360, height: 240 },
      tableScrollContainerRect: { left: 30, top: 80 },
      editorShellBottom: 260,
    });

    expect(style).toMatchObject({
      position: 'fixed',
      left: `${30 - TABLE_ROW_HEADER_WIDTH}px`,
      top: '80px',
      width: `${TABLE_ROW_HEADER_WIDTH}px`,
      height: '180px',
    });
  });
});
