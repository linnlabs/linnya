/**
 * LayoutPrimitives — 沙箱注入的场景图工厂函数源码
 *
 * 导出一段纯 JavaScript 源码字符串，在沙箱执行用户代码前 prepend。
 * 工厂函数返回带 `_type` 标记的可变 JS 对象，AI 通过逐行属性赋值配置节点，
 * 通过 add() 方法组装父子关系。
 *
 * 设计理念：Figma Plugin API 的命令式场景图模式 + CSS Flexbox 属性名。
 * 三阶段解耦：创建节点 → 配置属性 → 组装树。
 *
 * AI 在沙箱中的使用方式：
 *   const slide = createSlide();
 *   slide.background = { color: "#FFF" };
 *   // 背景与 shape fill 可直接使用结构化 linear / radial gradient；
 *   // 线条通过 border.paint 使用 linear gradient。
 *
 *   const frame = createFrame();
 *   frame.flexDirection = "column";
 *   frame.padding = 0.5;
 *   frame.gap = 0.2;
 *
 *   const title = createText("标题");
 *   title.fontSize = 24;
 *   title.fontWeight = "bold";
 *
 *   frame.add(title);
 *   slide.add(frame);
 *   compose({ title: "报告", slides: [slide] });
 */

/**
 * 注入沙箱的场景图工厂函数 JavaScript 源码。
 *
 * 容器节点（createSlide / createFrame）带 children 数组和 add() 方法；
 * 叶子节点（createText / createShape / ...）只有属性，无 add()。
 *
 * ## 关于"工厂能否接收 config 对象"
 *
 * 历史上工厂只接受 0 或 1 个固定位置参数（如 `createImage(src)`），
 * AI 经常按 React/Konva 习惯写 `createShape({ x, y, w, h, fill })`，
 * 这些字段被静默丢弃，最终渲染出空形状，且不抛错——典型的"代码执行
 * 成功但视觉缺失"幽灵 bug。
 *
 * 当前实现：
 * - 工厂仍以"3 阶段（创建 → 配置 → 组装）"为主路径；
 * - **但同时接受一个 plain config 对象**，会被 Object.assign 到节点上，
 *   兼容 React 风格的一行写法；
 * - `createImage({ kind, ... })` 是图片来源对象，不是视觉 config；
 *   工厂会把它归一为 `node.src`，避免图片来源被静默丢弃；
 * - 当传入的不是 string/plain-object/null/undefined（例如 number、Array、
 *   class 实例），抛出明确的错误提示，避免静默吞参。
 */
export const LAYOUT_PRIMITIVES_SOURCE = `
// 为容器节点注入 add() 方法，支持可变参数和数组展平
function _addMethod(node) {
  node.add = function() {
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (Array.isArray(a)) {
        for (var j = 0; j < a.length; j++) { if (a[j] != null) node.children.push(a[j]); }
      } else if (a != null) {
        node.children.push(a);
      }
    }
    return node;
  };
  return node;
}

// 判断是否是纯对象（{} 字面量），用来识别"AI 传了 config 对象"的情况
function _isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  var proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

// 把 plain object 的字段拷贝到节点上（不覆盖 _type / children / add）；
// 不是 plain object 则抛出明确错误，告诉 AI 该用哪种调用方式
function _applyConfig(fnName, node, config) {
  if (config == null) return node;
  if (!_isPlainObject(config)) {
    throw new Error(
      fnName + '() 只接受一个 plain config 对象作为可选参数（例如 ' +
      fnName + '({ width: 4, height: 2, fill: "#000" })），' +
      '或先 ' + fnName + '() 再逐行赋值（const s = ' + fnName + '(); s.fill = "#000";）。' +
      '收到了：' + (Array.isArray(config) ? 'Array' : typeof config) + '。'
    );
  }
  for (var k in config) {
    if (!Object.prototype.hasOwnProperty.call(config, k)) continue;
    if (k === '_type' || k === 'children' || k === 'add') continue;
    node[k] = config[k];
  }
  return node;
}

function _isImageSourceObject(value) {
  if (!_isPlainObject(value)) return false;
  return value.kind === 'external_url' ||
    value.kind === 'data_uri' ||
    value.kind === 'local_path' ||
    value.kind === 'generated_asset' ||
    value.kind === 'brush_artwork';
}

function _copyImageSourceObject(value) {
  switch (value.kind) {
    case 'external_url':
      return { kind: 'external_url', url: value.url };
    case 'data_uri':
      return { kind: 'data_uri', dataUri: value.dataUri };
    case 'local_path':
      return { kind: 'local_path', path: value.path };
    case 'generated_asset':
      return { kind: 'generated_asset', assetId: value.assetId };
    case 'brush_artwork':
      return {
        kind: 'brush_artwork',
        seed: value.seed,
        backgroundColor: value.backgroundColor,
        quality: value.quality,
        layers: value.layers
      };
  }
}

function _isSvgGraphicSourceObject(value) {
  if (!_isPlainObject(value)) return false;
  return value.kind === 'inline_svg' ||
    value.kind === 'local_path' ||
    value.kind === 'conversation_file';
}

function _copySvgGraphicSourceObject(value) {
  switch (value.kind) {
    case 'inline_svg':
      return { kind: 'inline_svg', svg: value.svg };
    case 'local_path':
      return { kind: 'local_path', path: value.path };
    case 'conversation_file':
      return { kind: 'conversation_file', locator: value.locator };
  }
}

function createSlide(config) {
  var node = _addMethod({ _type: 'Slide', children: [] });
  return _applyConfig('createSlide', node, config);
}

function createFrame(config) {
  var node = _addMethod({ _type: 'View', children: [] });
  return _applyConfig('createFrame', node, config);
}

function createText(content) {
  var node = { _type: 'Text' };
  if (content == null) return node;
  if (typeof content === 'string') {
    node.content = content;
    return node;
  }
  if (Array.isArray(content)) {
    // Text / Formula run 只做字段形状归一化；公式语义必须保留给 Flex compiler 校验。
    node.content = content.map(function(item) {
      if (typeof item === 'string') return { text: item };
      if (item && typeof item === 'object') {
        var run = Object.prototype.hasOwnProperty.call(item, 'formula')
          ? { formula: item.formula }
          : { text: String(item.text || '') };
        var s = item.style || item.options;
        if (s && typeof s === 'object') run.style = s;
        return run;
      }
      return { text: String(item) };
    });
    return node;
  }
  if (_isPlainObject(content)) {
    // 接受 createText({ content: '...', fontSize: 24, fill: '#000' }) 写法
    return _applyConfig('createText', node, content);
  }
  // 数字/布尔等基础类型：保留旧的 String(...) 兼容行为
  node.content = String(content);
  return node;
}

function createShape(config) {
  var node = { _type: 'Shape' };
  return _applyConfig('createShape', node, config);
}

function createChart(presetOrConfig) {
  var node = { _type: 'Chart' };
  if (presetOrConfig == null) return node;
  if (typeof presetOrConfig === 'string') {
    node.preset = presetOrConfig;
    return node;
  }
  return _applyConfig('createChart', node, presetOrConfig);
}

function createBrushArtwork(config) {
  if (!_isPlainObject(config)) {
    return _applyConfig('createBrushArtwork', { _type: 'Image' }, config);
  }
  var node = {
    _type: 'Image',
    src: {
      kind: 'brush_artwork',
      seed: config.seed,
      backgroundColor: config.backgroundColor,
      quality: config.quality,
      layers: config.layers
    }
  };
  for (var k in config) {
    if (!Object.prototype.hasOwnProperty.call(config, k)) continue;
    if (k === 'seed' || k === 'backgroundColor' || k === 'quality' || k === 'layers') continue;
    node[k] = config[k];
  }
  return node;
}

function createTable(config) {
  var node = { _type: 'Table' };
  return _applyConfig('createTable', node, config);
}

function createImage(srcOrConfig) {
  var node = { _type: 'Image' };
  if (srcOrConfig == null) return node;
  if (typeof srcOrConfig === 'string') {
    node.src = srcOrConfig;
    return node;
  }
  if (_isImageSourceObject(srcOrConfig)) {
    node.src = _copyImageSourceObject(srcOrConfig);
    for (var k in srcOrConfig) {
      if (!Object.prototype.hasOwnProperty.call(srcOrConfig, k)) continue;
      if (k === 'kind' || k === 'url' || k === 'dataUri' || k === 'path' || k === 'assetId' ||
          k === 'seed' || k === 'backgroundColor' || k === 'quality' || k === 'layers') continue;
      node[k] = srcOrConfig[k];
    }
    return node;
  }
  return _applyConfig('createImage', node, srcOrConfig);
}

function createSvgGraphic(sourceOrConfig) {
  var node = { _type: 'SvgGraphic' };
  if (sourceOrConfig == null) return node;
  if (typeof sourceOrConfig === 'string') {
    node.source = { kind: 'inline_svg', svg: sourceOrConfig };
    return node;
  }
  if (_isSvgGraphicSourceObject(sourceOrConfig)) {
    node.source = _copySvgGraphicSourceObject(sourceOrConfig);
    for (var k in sourceOrConfig) {
      if (!Object.prototype.hasOwnProperty.call(sourceOrConfig, k)) continue;
      if (k === 'kind' || k === 'svg' || k === 'path' || k === 'locator') continue;
      node[k] = sourceOrConfig[k];
    }
    return node;
  }
  return _applyConfig('createSvgGraphic', node, sourceOrConfig);
}

function createFormula(latexOrConfig) {
  var node = { _type: 'Formula' };
  if (latexOrConfig == null) return node;
  if (typeof latexOrConfig === 'string') {
    node.latex = latexOrConfig;
    return node;
  }
  return _applyConfig('createFormula', node, latexOrConfig);
}

function createSpacer(config) {
  var node = { _type: 'Spacer' };
  return _applyConfig('createSpacer', node, config);
}
`;
