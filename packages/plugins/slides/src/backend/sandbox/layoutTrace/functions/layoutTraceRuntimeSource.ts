/**
 * Sandbox 内部的节点登记与 compose 根节点捕获。
 *
 * registry 只保存对象引用，最终在用户代码执行完后读取节点当前状态。这样既能
 * 覆盖“先创建、后配置、最后 add”的正常写法，也不会把 trace 字段塞进 compose payload。
 */
export const LAYOUT_TRACE_RUNTIME_SOURCE = `
var __layoutTraceMaxNodes = 1024;
var __layoutTraceMaxEdges = 2048;
var __layoutTraceRecords = [];
var __layoutTraceNodeIds = new WeakMap();
var __layoutTraceRoots = [];
var __layoutTraceTruncated = false;

function __withLoc(node, sourceSpan) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;

  node._sourceSpan = sourceSpan;
  if (__layoutTraceNodeIds.has(node)) return node;
  if (__layoutTraceRecords.length >= __layoutTraceMaxNodes) {
    __layoutTraceTruncated = true;
    return node;
  }

  var id = __layoutTraceRecords.length + 1;
  __layoutTraceNodeIds.set(node, id);
  __layoutTraceRecords.push({ id: id, node: node, sourceSpan: sourceSpan });
  return node;
}

function __withComposeTrace(composeFn, input) {
  __layoutTraceRoots = input && Array.isArray(input.slides) ? input.slides.slice() : [];
  return composeFn(input);
}

function __layoutTraceHasText(content) {
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  for (var i = 0; i < content.length; i++) {
    var item = content[i];
    if (typeof item === 'string' && item.trim().length > 0) return true;
    if (item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim().length > 0) return true;
  }
  return false;
}

function __layoutTraceHasBusinessContent(node) {
  switch (node._type) {
    case 'Text': return __layoutTraceHasText(node.content);
    case 'Chart': return Array.isArray(node.series) && node.series.length > 0;
    case 'Table': return (Array.isArray(node.headers) && node.headers.length > 0) ||
      (Array.isArray(node.rows) && node.rows.length > 0);
    case 'Image': return typeof node.src === 'string' ? node.src.trim().length > 0 : !!node.src;
    case 'SvgGraphic': return typeof node.source === 'string'
      ? node.source.trim().length > 0
      : !!node.source;
    case 'Formula': return typeof node.latex === 'string' && node.latex.trim().length > 0;
    case 'Shape': return __layoutTraceHasText(node.content) ||
      typeof node.fill === 'string' ||
      !!(node.fill && typeof node.fill === 'object');
    default: return false;
  }
}

function __layoutTraceIsConfiguredContainer(node) {
  if (node._type !== 'View') return false;
  var keys = Object.keys(node);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key !== '_type' && key !== '_sourceSpan' && key !== 'children' && key !== 'add') return true;
  }
  return false;
}

function __buildLayoutTrace() {
  var nodes = [];
  var edgeCount = 0;

  for (var i = 0; i < __layoutTraceRecords.length; i++) {
    var record = __layoutTraceRecords[i];
    var node = record.node;
    var children = [];
    if (Array.isArray(node.children)) {
      for (var j = 0; j < node.children.length; j++) {
        var childId = __layoutTraceNodeIds.get(node.children[j]);
        if (typeof childId !== 'number') continue;
        if (edgeCount >= __layoutTraceMaxEdges) {
          __layoutTraceTruncated = true;
          break;
        }
        children.push(childId);
        edgeCount += 1;
      }
    }

    nodes.push({
      id: record.id,
      type: node._type,
      startLine: record.sourceSpan.startLine,
      endLine: record.sourceSpan.endLine,
      children: children,
      configured: __layoutTraceIsConfiguredContainer(node),
      content: __layoutTraceHasBusinessContent(node)
    });
  }

  var roots = [];
  for (var r = 0; r < __layoutTraceRoots.length; r++) {
    var rootId = __layoutTraceNodeIds.get(__layoutTraceRoots[r]);
    if (typeof rootId === 'number') roots.push(rootId);
    else __layoutTraceTruncated = true;
  }

  return {
    version: 1,
    truncated: __layoutTraceTruncated,
    nodes: nodes,
    roots: roots
  };
}
`;
