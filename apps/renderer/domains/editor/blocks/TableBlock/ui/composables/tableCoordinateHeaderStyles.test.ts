import { describe, expect, it } from 'vitest';
import {
  buildTableColumnHeaderStyles,
  buildTableRowHeaderStyle,
  TABLE_COLUMN_HEADER_HEIGHT,
  TABLE_ROW_HEADER_WIDTH,
} from './tableCoordinateHeaderStyles';

describe('tableCoordinateHeaderStyles', () => {
  it('positions the column header track relative to the content layer, with a sticky bar inside', () => {
    const styles = buildTableColumnHeaderStyles({
      columnWidths: [100, 120, 140],
      tableRect: { left: 30, top: 80, width: 360, height: 200 },
      scrollLeft: 45,
      tableScrollContainerRect: { left: 30, top: 80 },
      visibleWidth: 240,
      hasScrollContainer: true,
      layerOrigin: { left: 10, top: -150 },
      scrollPaddingTop: 16,
    });

    expect(styles.trackStyle).toMatchObject({
      position: 'absolute',
      left: '20px',
      top: `${80 + 150 - TABLE_COLUMN_HEADER_HEIGHT}px`,
      width: '240px',
      height: `${200 + TABLE_COLUMN_HEADER_HEIGHT}px`,
    });
    expect(styles.floatingStyle).toMatchObject({
      position: 'sticky',
      top: '-16px',
      height: `${TABLE_COLUMN_HEADER_HEIGHT}px`,
    });
    expect(styles.scrollerStyle).toEqual({
      width: '360px',
      transform: 'translateX(-45px)',
    });
  });

  it('gives the same layer-relative position before and after the page scrolls (headers scroll natively)', () => {
    const at = (scroll: number) => ({
      track: buildTableColumnHeaderStyles({
        columnWidths: [100],
        tableRect: { left: 30, top: 300 - scroll, width: 100, height: 60 },
        scrollLeft: 0,
        tableScrollContainerRect: { left: 30, top: 300 - scroll },
        visibleWidth: 100,
        hasScrollContainer: true,
        layerOrigin: { left: 0, top: 40 - scroll },
        scrollPaddingTop: 0,
      }).trackStyle,
      row: buildTableRowHeaderStyle({
        tableRect: { left: 30, top: 300 - scroll, width: 100, height: 60 },
        tableScrollContainerRect: { left: 30, top: 300 - scroll },
        layerOrigin: { left: 0, top: 40 - scroll },
      }),
    });

    expect(at(400)).toEqual(at(0));
  });

  it('hides column header when table scroll container is not bound yet', () => {
    const styles = buildTableColumnHeaderStyles({
      columnWidths: [100],
      tableRect: { left: 0, top: 0, width: 100, height: 100 },
      scrollLeft: 0,
      tableScrollContainerRect: { left: 0, top: 0 },
      visibleWidth: 0,
      hasScrollContainer: false,
      layerOrigin: { left: 0, top: 0 },
      scrollPaddingTop: 0,
    });

    expect(styles.trackStyle).toEqual({ visibility: 'hidden' });
    expect(styles.scrollerStyle).toEqual({});
  });

  it('places row headers left of the table scroll container, as tall as the table', () => {
    const style = buildTableRowHeaderStyle({
      tableRect: { left: 60, top: 80, width: 360, height: 240 },
      tableScrollContainerRect: { left: 60, top: 80 },
      layerOrigin: { left: 10, top: -150 },
    });

    expect(style).toMatchObject({
      position: 'absolute',
      left: `${60 - 10 - TABLE_ROW_HEADER_WIDTH}px`,
      top: '230px',
      width: `${TABLE_ROW_HEADER_WIDTH}px`,
      height: '240px',
    });
  });
});
