// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT } from '../../../features/RenderVirtualization/state/keepAliveEvents';
import { createColumnResizePlugin } from './TableColumnResizeExtension';
import {
  dispatchTableColumnResizeKeepAlive,
  findColumnResizeHandleFromEventTarget,
  findRootBlockIdFromColumnResizeTarget,
  isFirstColumnResizeHandle,
} from './tableColumnResizeKeepAlive';

function createResizeDom(blockId = 'root-table') {
  const editorDom = document.createElement('div');
  const rootOuter = document.createElement('div');
  rootOuter.className = 'root-block-outer';
  rootOuter.setAttribute('data-id', blockId);

  const rootBlock = document.createElement('div');
  rootBlock.className = 'root-block';
  const content = document.createElement('div');
  content.className = 'content';
  const table = document.createElement('table');
  const row = table.insertRow();
  const firstCell = row.insertCell();
  const secondCell = row.insertCell();
  const firstHandle = document.createElement('span');
  const secondHandle = document.createElement('span');
  firstHandle.className = 'column-resize-handle';
  secondHandle.className = 'column-resize-handle';

  firstCell.appendChild(firstHandle);
  secondCell.appendChild(secondHandle);
  content.appendChild(table);
  rootBlock.appendChild(content);
  rootOuter.appendChild(rootBlock);
  editorDom.appendChild(rootOuter);
  document.body.appendChild(editorDom);

  return {
    editorDom,
    firstHandle,
    secondHandle,
    cleanup: () => editorDom.remove(),
  };
}

describe('tableColumnResizeKeepAlive', () => {
  it('resolves resize handles and rootBlock id from nested event targets', () => {
    const dom = createResizeDom('root-resize');
    const nestedText = document.createTextNode('drag');
    dom.secondHandle.appendChild(nestedText);

    expect(findColumnResizeHandleFromEventTarget(nestedText)).toBe(dom.secondHandle);
    expect(findRootBlockIdFromColumnResizeTarget(nestedText)).toBe('root-resize');
    expect(isFirstColumnResizeHandle(dom.firstHandle)).toBe(true);
    expect(isFirstColumnResizeHandle(dom.secondHandle)).toBe(false);

    dom.cleanup();
  });

  it('dispatches dedicated table-column-resize keep-alive events', () => {
    const dom = createResizeDom('root-resize');
    const events = [];
    dom.editorDom.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
      events.push(event.detail);
    });

    dispatchTableColumnResizeKeepAlive(dom.editorDom, 'root-resize', true);
    dispatchTableColumnResizeKeepAlive(dom.editorDom, 'root-resize', false);

    expect(events).toEqual([
      { blockId: 'root-resize', reason: 'table-column-resize', active: true },
      { blockId: 'root-resize', reason: 'table-column-resize', active: false },
    ]);

    dom.cleanup();
  });

  it('pins on resize mousedown and releases on global mouseup', () => {
    const dom = createResizeDom('root-resize');
    const events = [];
    dom.editorDom.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
      events.push(event.detail);
    });

    const plugin = createColumnResizePlugin();
    const view = { dom: dom.editorDom };
    const pluginView = plugin.spec.view(view);

    plugin.props.handleDOMEvents.mousedown(view, { target: dom.secondHandle });
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(events).toEqual([
      { blockId: 'root-resize', reason: 'table-column-resize', active: true },
      { blockId: 'root-resize', reason: 'table-column-resize', active: false },
    ]);

    pluginView.destroy();
    dom.cleanup();
  });

  it('does not pin the first column resize handle', () => {
    const dom = createResizeDom('root-resize');
    const events = [];
    dom.editorDom.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
      events.push(event.detail);
    });

    const plugin = createColumnResizePlugin();
    const view = { dom: dom.editorDom };
    const pluginView = plugin.spec.view(view);

    plugin.props.handleDOMEvents.mousedown(view, { target: dom.firstHandle });

    expect(events).toEqual([]);

    pluginView.destroy();
    dom.cleanup();
  });
});
