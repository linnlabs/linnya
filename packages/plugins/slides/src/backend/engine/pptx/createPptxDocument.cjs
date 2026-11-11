// PptxGenJS 的 require 导出就是构造器。显式选择该入口，避免 tsx 与打包器对
// .es.js 的 default 互操作处理不同；这里不猜测或回退到嵌套 default。
const PptxGenJS = require('pptxgenjs');
exports.createPptxDocument = () => new PptxGenJS();
