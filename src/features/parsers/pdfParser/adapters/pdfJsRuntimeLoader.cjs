'use strict';

// pdfjs-dist 的运行入口是纯 ESM。该桥接保留为普通 CJS，让 Bytenode 后端能通过
// Electron 主上下文 loader 加载它；业务模块本身不再执行动态 import()。
var pathToFileURL = require('node:url').pathToFileURL;
var vm = require('node:vm');

function importPdfJsFromMainContext() {
  var useMainContextLoader = vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER;
  if (useMainContextLoader == null) {
    throw new Error('当前 Electron 运行时不支持主上下文 ESM loader。');
  }
  var specifier = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.js')).href;
  var importModule = vm.compileFunction(
    'return import(' + JSON.stringify(specifier) + ')',
    [],
    { importModuleDynamically: useMainContextLoader },
  );
  return importModule();
}

var pdfJsPromise;

exports.loadPdfJs = function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = importPdfJsFromMainContext();
  }
  return pdfJsPromise;
};
