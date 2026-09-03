'use strict';

// harfbuzzjs 是带顶层 await 的纯 ESM 包，而 Backend/standalone CLI 会打成 CJS。
// 因此必须由保留在普通 CJS 中的窄桥接显式提供主上下文 ESM loader。
var pathToFileURL = require('node:url').pathToFileURL;
var vm = require('node:vm');

function resolveHarfBuzzSpecifier() {
  return pathToFileURL(require.resolve('harfbuzzjs')).href;
}

function importFromMainContext(specifier) {
  var useMainContextLoader = vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER;
  if (useMainContextLoader == null) {
    throw new Error('当前 Node 运行时不支持主上下文 ESM loader。');
  }
  var importModule = vm.compileFunction(
    'return import(' + JSON.stringify(specifier) + ')',
    [],
    { importModuleDynamically: useMainContextLoader },
  );
  return importModule();
}

var harfbuzzPromise;

exports.loadHarfBuzz = function loadHarfBuzz() {
  if (!harfbuzzPromise) {
    harfbuzzPromise = importFromMainContext(resolveHarfBuzzSpecifier());
  }
  return harfbuzzPromise;
};
