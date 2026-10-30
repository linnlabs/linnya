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

## 围栏代码合同

StreamingParser 与 blocks API 共用围栏规则：至少三个连续反引号或 tilde，
最多三个前导空格；closing fence 必须同字符、长度不短于 opener，尾部只能是空格或 tab。
反引号 opener 的 info string 不能含反引号；language 取 info string 的首个词，
不会猜测或删除正文中的语言名称。规则依据 [CommonMark 4.5](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)。

解析状态保留 marker、长度与 opener 缩进，等完整行或 EOF 再判定围栏，分片位置不改变结果。
正文按 opener 缩进去除最多相应列数，保留其余空格、tab、空行及空代码块；CRLF 规范化为 LF。
块事件采用编辑器文本合同：结尾至多去掉一个行分隔 LF，导出时由 serializer 补回；
不能使用 trim，也不能把代码中的 Markdown、HTML comment 或 citation 解释为文档结构。
围栏拼写和附加 info 元数据不进入持久化 schema，承诺 canonical 内容等价，不承诺源码逐字复原。
此规则不扩展现有列表/引用容器解析能力，也不代表整个解析器通过 CommonMark conformance。

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

## 列表与表格来源属性

列表事件的 `attrs.start` 保存实际非负数字（包括 0），`attrs.marker` 保存 `-/*/+` 或有序 delimiter
`./)`。Node 和 Renderer 物化使用这份正式属性，不从去掉 marker 的正文推断。
表格事件的 `alignments` 是列对齐的事实源，物化为 cell `align`，导出仍保留冒号位置。

`attrs.separatorBefore` 记录当前列表项前是否有空行：`tight` 表示单换行，`loose` 表示空行。
Streaming core 保留已消费前缀的行间隔状态，因此 chunk 切分不会丢掉列表紧凑性。
这是现有扁平 ListItemBlock 的间隔事实，不新增任意多段落列表容器；无来源属性的旧文档不回填猜测。

## 图片与公式边界

独占段落的 Markdown 图片输出 `ImageBlock`，标签作为 caption；混排图片保留结构化 fragment 供消费端明确拒绝，不能丢弃。解析器只识别语法，来源权限与资产接管属于 Host。`image_math_tests.rs` 覆盖所有 UTF-8 切分边界；公式正文按 Unicode 字符累计，分隔符仍按 ASCII 判断。文字段首 `[` 的 canonical 输出由序列化器编码为 `&#91;`，避免与块公式起始符冲突。
