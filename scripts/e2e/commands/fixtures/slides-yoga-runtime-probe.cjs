'use strict';

// 该探针只用于 packaged command-mode 验收：把它临时放到已登记 Slides CLI entry，
// 证明 host resolver 能从 app runtime 定位并加载 yoga-layout/load 的 ESM 子路径。
const { app } = require('electron');
const { loadYoga } = require('./yogaRuntimeLoader.cjs');

loadYoga().then(
  (yoga) => {
    const config = yoga.Config.create();
    const node = yoga.Node.create(config);
    try {
      node.setWidth(320);
      node.setHeight(180);
      node.calculateLayout(320, 180, yoga.DIRECTION_LTR);
      process.stdout.write(JSON.stringify({
        width: node.getComputedWidth(),
        height: node.getComputedHeight(),
      }));
      app.exit(0);
    } finally {
      node.free();
      config.free();
    }
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    app.exit(10);
  },
);
