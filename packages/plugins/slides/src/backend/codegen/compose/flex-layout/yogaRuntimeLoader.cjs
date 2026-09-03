'use strict';

// yoga-layout v3 是纯 ESM 包（"type": "module"）。
//
// Electron Main 的字节码加载链替换了 Module.prototype._compile，
// 在其中创建 vm.Script 时未传入 importModuleDynamically 回调。
// 导致所有通过 require() 加载的 CJS 模块内部的 import() 表达式
// 都会因缺少动态导入回调而失败：
//   - require('yoga-layout/load')  → SyntaxError（ESM 被当 CJS 编译）
//   - import('yoga-layout/load')   → ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING
//
// 解决方案：通过 vm.compileFunction() 显式指定
// importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER，
// 使 import() 使用主上下文的 ESM loader，绕开 NativeCompileCache 的限制。

var pathToFileURL = require('url').pathToFileURL;
var vm = require('vm');

function resolveYogaLoadSpecifier() {
  // 公网安装后的插件运行在用户插件目录，不应依赖仓库根 node_modules。
  // 先按 helper 自己的位置解析随 artifact 分发的 yoga-layout，再用 file URL import ESM。
  try {
    return pathToFileURL(require.resolve('yoga-layout/load')).href;
  } catch (_error) {
    return 'yoga-layout/load';
  }
}

function createESMImporter(specifier) {
  var USE_MAIN = vm.constants && vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER;
  if (USE_MAIN != null) {
    var doImport = vm.compileFunction(
      'return import(' + JSON.stringify(specifier) + ')',
      [],
      { importModuleDynamically: USE_MAIN }
    );
    return doImport();
  }
  // Node < 22.8 回退：直接 import()（在非 Electron 环境下可能正常工作）
  return import(specifier);
}

var yogaPromise;

exports.loadYoga = async function loadYoga() {
  if (!yogaPromise) {
    yogaPromise = createESMImporter(resolveYogaLoadSpecifier())
      .then(function (mod) { return mod.loadYoga(); });
  }
  return yogaPromise;
};
