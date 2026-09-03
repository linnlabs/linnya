# `parser-wasm`

`parser-wasm` 是 Linnya Renderer 使用的 Markdown
WebAssembly 解析 package。Rust 源码与 workspace
package 清单是受跟踪真源；`pkg/`、`pkg-node/` 和 `target/`
都是可再生构建产物，不进入 Git。

## 边界

- `src/` 拥有解析规则、流式状态与输出模型；
- 根 `package.json` 只声明稳定的 workspace 身份、Web 入口和构建命令；
- `pkg/` 是 Renderer 使用的 Web ESM/WASM 产物；
- `pkg-node/` 是 Node 侧测试、benchmark 与打包流程使用的产物；
- 上层应用不得直接维护另一份生成包清单，也不得要求依赖安装前先存在生成目录。

首次依赖安装只需要受跟踪的 workspace package 清单。运行 Renderer、测试 Node
adapter 或生成安装包前，再通过根命令构建两个目标：

```bash
pnpm install --frozen-lockfile
pnpm run build:wasm
```

构建需要 Rust、`wasm32-unknown-unknown` target 和
`wasm-pack`。`pnpm run dev:electron` 与正式打包入口会主动执行
`build:wasm`，不存在读取旧产物的 fallback。

## 发布状态

该 package 当前服务 Linnya
workspace，`private: true`，不单独发布 npm。未来公开源码不等于立即增加独立 npm 发布面；根许可证确定后，还需要同步补齐 Cargo 与生成 package 的许可证、repository 和 NOTICE 元数据，才能讨论独立分发。
