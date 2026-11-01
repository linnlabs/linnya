# Font Resolution

默认系统字体目录由 Platform backend runtime effect 在当前 Backend 运行域内装配。缓存路径只来自 App owner
冻结的 `RuntimePathRoots.appDataRoot`；这里不能加载 Electron `app`、读取自己的 cwd 或在缺少路径事实时静默跳过。
字体 catalog 缓存是可重建数据，Main 与未来 headless App Server 使用同一条 data-only 路径合同。

字体解析/替换决策是平台排版能力：Slides、测量服务和后续 LineLayoutEngine 必须消费同一份字体解析结果，避免 prewarm 与 sync measure 的缓存键因为字体口径不同而错位。

## 边界

- `definitions/`：字体元数据、请求与解析结果 DTO。
- `functions/`：字体文件解析、脚本分类、cmap 覆盖、替换打分等纯函数。
- `orchestration/`：系统字体目录扫描、metadata 缓存、请求解析和只读字体族查询流程。

## 归属纪律

- 这里不依赖 Slides、renderer 或 Electron 窗口对象。
- macOS 同时扫描标准字体目录和 `AssetsV2/com_apple_MobileAsset_Font8` 按需字体资产目录；未下载的字体仍报告未安装，不下载或复制系统字体。
- `.ttc` collection 是 macOS 字体目录的主路径；扫描时必须枚举所有 face，不能默认取第一个 face。
- FontCatalog 只缓存系统字体 metadata 与文件身份（path/mtime/size），不复制、不缓存、不打包字体文件本体。
- 冷扫描通过 Node 流式读取计算文件 SHA-256，并使用 fontkit 异步打开文件；不能在业务 Backend 事件循环同步读取和散列整份系统字体。大型 CJK collection 和慢磁盘会让普通 Renderer RPC 超时。同步单文件解析入口仍供显式同步调用使用，不能作为目录扫描默认实现。
- FontCatalog 以 `idle -> scanning -> ready | failed` 表达扫描生命周期。查询必须等待 `ready/failed` 真实终态；`failed` 或尚未启动扫描时抛出稳定的 `FontCatalogUnavailableError`，不能返回假的空目录。
- Backend runtime effect 退出时须 dispose 当前目录并等待正在读取的文件完成；`disposed` 后不再遍历或解析下一份字体，不发布部分索引、不覆盖成功缓存。后台扫描不能越过 Backend owner 的退出屏障继续运行。
- FontResolutionService 是唯一的字体解析入口：目录未就绪时返回 `catalogReady=false` 并沿用原始字体名；目录就绪后用 OS/2 Unicode range 建立主导脚本粗候选池，再用字体 cmap 对当前 run 的实际 code point 做全覆盖判断。精确 family 已安装但 cmap 不覆盖正文时同样不能强行命中；OS/2 漏报某个 block 时不能否定 cmap 的真实字形。
- FontCatalogQueryService 是面向插件的只读事实入口：`checkFamily` 按规范化 family 精确检查，`listFamilies` 按脚本稳定排序、去重、过滤点号前缀的系统内部 UI 字体、限制 1–100 项并以 offset 分页。查询结果只包含 family、脚本候选、regular/bold/italic 和 monospace，不暴露 file path、PostScript name、face index 或缓存信息。
- 完整应用由 platform runtime effect 配置默认字体解析与查询；独立 backend 进程必须持有 `SystemFontResolutionRuntime`，等待同一份 catalog 扫描完成后再执行业务，并在进程生命周期结束时 dispose。只创建 `SystemFontCatalogQueryRuntime` 不能让默认排版解析器就绪。
- `resolvedFamily` 是渲染/测量应使用的字体声明，`fontFamily/request.family` 是 PPTX 导出必须保留的原始声明。
- 替换打分只表达“谁更接近”，不锁定绝对分数；候选 PANOSE 的 `0/Any` 与非正 `xAvgCharWidth` 是低置信 metadata，必须计入罚分，不能被当作零差异。请求 family 已安装但缺少当前字形时，仍必须用该 family 中最接近请求样式的 face 作为相似度参考，不能退回通用脚本基线。只要存在 bold/italic 完全匹配且 cmap 覆盖正文的 face，就只能在该样式集合内继续比较；样式不匹配的 face 只在没有匹配样式时参与选择。
- 原始请求字体名和解析后的字体名要同时保留：渲染/测量使用解析结果，PPTX 导出继续写原始字体名。
- OS/2 Unicode Range 只用于 `latin`、`eastAsian`、`complex` 候选池。bit 60 是 Private Use Area，不属于 CJK。最终覆盖事实来自 fontkit `characterSet` 压缩后的 cmap 闭区间；FontCatalog cache 持久化这些区间，不持久化字体文件本体。
- macOS 点号前缀 family 是系统内部 UI 实现：精确请求仍可查询安装事实，但不能进入 AI 设计列表或缺失字体替代池。
- 对外样式只承诺 regular、bold、italic；bold 二档包含 OS/2 bold 标志或 weight class ≥600 的字面，让 PingFang 等仅提供 Semibold 的字体正确参与粗体匹配。数值字重不在当前查询合同内。catalog cache v5 会重新扫描旧缓存，避免沿用把所有 PingFang 字重归为 regular 的事实。

## 验证入口

- 确定性查询与解析测试使用可注入 catalog，并包含 Heiti SC 标点漏报与 regular/bold 竞争语料：`pnpm exec vitest run src/features/font-resolution packages/plugins/slides/src/backend/engine/text/__tests__/font-resolution-integration.test.ts`。
- 真实系统目录与浏览器渲染 smoke：`pnpm --dir packages/plugins/slides run smoke:raster-worker`。该命令从当前机器分别读取 Latin / East Asian 候选，验证主题字体经 deck.js、RenderModel 和共享文本布局进入 Electron raster worker。强调回归使用真实 HarfBuzz 和像素比较，覆盖普通、粗体、斜体、粗斜体及显式取消；已安装 PingFang SC 时必须验证 Semibold 与 Regular 命中不同字面。图片保存在 Slides 的 `dist/dev/text-emphasis-fidelity/`。
- 真实 smoke 只能证明“当前机器的候选可进入完整渲染链”，不能把 OS/2 脚本候选提升为某种自然语言的完整字形覆盖证明。

`resolveFontText` 是需要混合字形回退的文本入口：按完整 grapheme 解析 cmap 覆盖，连续同 face、同脚本的片段合并。它保留每段原始请求字体，不让一个缺失汉字替换整段拉丁数字。调用方不能拆开组合字符或把解析 family 写回作者字体声明。
