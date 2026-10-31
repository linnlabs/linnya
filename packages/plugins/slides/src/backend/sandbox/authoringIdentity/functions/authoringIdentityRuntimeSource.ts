/**
 * 创建路径独立于布局诊断登记表。重复路径只在同一生成程序摘要内使用序号；
 * 改稿后不靠文字、坐标或数量猜测同一对象，旧覆盖留在源码供显式恢复。
 */
import { hashAuthoringPath } from './authoringPathKey.js';

export const AUTHORING_IDENTITY_RUNTIME_SOURCE = `
var __authoringHash = ${hashAuthoringPath.toString()};
var __authoringStack = [];
var __authoringNames = [];
var __authoringOrigins = new WeakMap();
function __withAuthoringScope(anchor, evaluate, name) {
  if (__authoringStack.indexOf(anchor) >= 0) anchor = 'r:' + anchor;
  __authoringStack.push(anchor);
  __authoringNames.push(name);
  try { return evaluate(); } finally { __authoringStack.pop(); __authoringNames.pop(); }
}
function __trackAuthoringNode(node, owner) {
  var indirect = owner && __authoringNames[__authoringNames.length - 2] !== owner;
  if (node && typeof node === 'object') __authoringOrigins.set(node, (indirect ? 'r:' : '') + __authoringStack.join('/'));
  return node;
}
function __assignAuthoringIdentities(input) {
  if (!input || !Array.isArray(input.slides)) return;
  // 作者可以复用同一个节点对象挂到多个位置；身份属于挂载实例，不能相互覆盖。
  function cloneOccurrence(node) {
    var copy = Object.assign({}, node);
    var origin = __authoringOrigins.get(node);
    if (origin) __authoringOrigins.set(copy, origin);
    if (Array.isArray(node.children)) copy.children = node.children.map(cloneOccurrence);
    return copy;
  }
  input.slides = input.slides.map(cloneOccurrence);
  var slideCounts = new Map();
  input.slides.forEach(function(slide) { if (slide.slideKey) slideCounts.set(slide.slideKey, (slideCounts.get(slide.slideKey) || 0) + 1); });
  input.slides.forEach(function(slide, slideIndex) {
    if (!slide.slideKey || slideCounts.get(slide.slideKey) > 1) {
      var origin = __authoringOrigins.get(slide);
      slide.slideKey = 'sysp_' + __authoringHash(origin || (__authoringGeneration + ':' + slideIndex));
    }
    var nodes = [], paths = new Map(), keys = new Map();
    function walk(node) {
      if (node !== slide && node._type !== 'Spacer') {
        var path = __authoringOrigins.get(node);
        // 所有工厂生成的原子对象与装饰 Frame 可编辑；布局容器不增加点击层级。
        if (node._type !== 'View' || node.backgroundColor || node.border || node.editKey) {
          path = path || (__authoringGeneration + ':untraced:' + nodes.length);
          nodes.push({ node: node, path: path });
          paths.set(path, (paths.get(path) || 0) + 1);
          if (node.editKey) keys.set(node.editKey, (keys.get(node.editKey) || 0) + 1);
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    }
    walk(slide);
    var occurrences = new Map(), identities = new Map();
    nodes.forEach(function(entry) {
      var node = entry.node, path = entry.path;
      if (node.editKey && keys.get(node.editKey) === 1) return;
      var ordinal = occurrences.get(path) || 0;
      occurrences.set(path, ordinal + 1);
      var repeated = paths.get(path) > 1 || path.indexOf(':untraced:') >= 0 || path.indexOf('r:') >= 0;
      var identity = repeated ? path + ':' + __authoringGeneration + ':' + ordinal : path;
      var key = (repeated ? 'sysr_' : 'sysu_') + __authoringHash(identity);
      if (identities.has(key) && identities.get(key) !== identity) throw new Error('Slides authoring identity collision');
      identities.set(key, identity);
      node.editKey = key;
    });
  });
}
`;
