import { describe, expect, it } from 'vitest';

import type { LayoutTraceSnapshot } from '../../../sandbox/layoutTrace';
import { validateLayoutTrace } from './validateLayoutTrace';

const SLIDE_RANGES = [{
  slideNumber: 1,
  startLine: 1,
  endLine: 20,
  contentStartLine: 1,
  contentEndLine: 20,
}];

describe('validateLayoutTrace', () => {
  it('只报告未挂载子树的根节点，并单独报告未挂载可见叶子', () => {
    const trace: LayoutTraceSnapshot = {
      version: 1,
      truncated: false,
      roots: [1],
      nodes: [
        node(1, 'Slide', 1, [2]),
        node(2, 'View', 2, [3], true),
        node(3, 'Text', 3, [], false, true),
        node(4, 'View', 8, [5], true),
        node(5, 'Chart', 9, [], false, true),
        node(6, 'Text', 12, [], false, true),
      ],
    };

    expect(validateLayoutTrace(trace, SLIDE_RANGES)).toEqual([
      expect.objectContaining({
        code: 'LAYOUT_UNATTACHED_CONTENT_SUBTREE',
        message: '该容器包含可见内容，但没有通过 .add(...) 加入最终页面层级，因此整个容器及其内容都不会渲染。',
        hint: '检查该行对应的容器变量是否漏写 slide.add(variable) 或 parent.add(variable)，以及 .add(...) 的父容器是否写错。',
        slideNumber: 1,
        sourceSpan: { startLine: 8, endLine: 8 },
      }),
      expect.objectContaining({
        code: 'LAYOUT_UNATTACHED_RENDERABLE_NODE',
        message: '该可见元素已创建，但没有通过 .add(...) 加入最终页面层级，因此不会渲染。',
        hint: '检查该行对应的元素变量，并通过 slide.add(variable) 或 parent.add(variable) 将它加入当前页面。',
        slideNumber: 1,
        sourceSpan: { startLine: 12, endLine: 12 },
      }),
    ]);
  });

  it('报告已配置但无内容的未挂载 Frame', () => {
    const trace: LayoutTraceSnapshot = {
      version: 1,
      truncated: false,
      roots: [1],
      nodes: [
        node(1, 'Slide', 1),
        node(2, 'View', 4, [], true),
      ],
    };

    expect(validateLayoutTrace(trace, SLIDE_RANGES)).toEqual([
      expect.objectContaining({
        code: 'LAYOUT_UNATTACHED_CONFIGURED_CONTAINER',
        message: '该 Frame 已设置布局属性，但没有通过 .add(...) 加入最终页面层级，因此这些设置不会生效。',
        hint: '检查创建该 Frame 的 helper 参数，并确认没有漏写 slide.add(variable) 或 parent.add(variable)，且父容器选择正确。',
        sourceSpan: { startLine: 4, endLine: 4 },
      }),
    ]);
  });

  it('合法的 Slide Flex 根与其后代不产生诊断', () => {
    const trace: LayoutTraceSnapshot = {
      version: 1,
      truncated: false,
      roots: [1],
      nodes: [
        node(1, 'Slide', 1, [2], true),
        node(2, 'View', 2, [3], true),
        node(3, 'Text', 3, [], false, true),
      ],
    };

    expect(validateLayoutTrace(trace, SLIDE_RANGES)).toEqual([]);
  });

  it('trace 截断时不报告未挂载问题，避免不完整图导致误报', () => {
    const trace: LayoutTraceSnapshot = {
      version: 1,
      truncated: true,
      roots: [1],
      nodes: [node(1, 'Slide', 1), node(2, 'Text', 2, [], false, true)],
    };

    expect(validateLayoutTrace(trace, SLIDE_RANGES)).toEqual([]);
  });
});

function node(
  id: number,
  type: LayoutTraceSnapshot['nodes'][number]['type'],
  line: number,
  children: number[] = [],
  configured = false,
  content = false,
): LayoutTraceSnapshot['nodes'][number] {
  return {
    id,
    type,
    startLine: line,
    endLine: line,
    children,
    configured,
    content,
  };
}
