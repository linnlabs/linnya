# `parser-wasm`

`parser-wasm` 是 Linnya Renderer 与后端 Markdown 导入使用的 Markdown
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

## 行内样式合同

[`src/inline.rs`](./src/inline.rs) 拥有行内事件到
[`ContentFragment`](./src/model.rs) 的投影。解析事件保留完整嵌套栈；片段的
`marks` 表达当前生效的样式集合，按类型与完整属性去重，保持首次出现的顺序。
合法的同型嵌套 emphasis / strong / strikethrough 不生成重复 mark，内层结束也不结束外层样式。
文本、软换行、硬换行与保留为文本的 HTML 片段共享该投影；表格单元格复用同一行内解析入口。

这里只生成格式语义，不依赖文档身份或持久化 schema。消费方仍执行自己的严格 schema
校验，不通过接受重复 marks 或删除未知属性修复文档。Node 与 Web 构建使用同一 Rust 实现。

修改行内规则后，从仓库根运行 `cargo test --manifest-path packages/parser-wasm/Cargo.toml --locked`，
再执行 `pnpm run build:wasm`。真实后端导入回归见
[`importMarkdownStrongEmphasis.test.ts`](../../src/domains/markdown/features/normalization/__tests__/importMarkdownStrongEmphasis.test.ts)，
通过 `pnpm test -- src/domains/markdown/features/normalization` 验证其导入、块规划与存储 schema 合同。

## 发布状态

该 package 当前服务 Linnya
workspace，`private: true`，不单独发布 npm。
