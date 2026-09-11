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
- FontCatalog 以 `idle -> scanning -> ready | failed` 表达扫描生命周期。查询必须等待 `ready/failed` 真实终态；`failed` 或尚未启动扫描时抛出稳定的 `FontCatalogUnavailableError`，不能返回假的空目录。
- FontResolutionService 是唯一的字体解析入口：目录未就绪时返回 `catalogReady=false` 并沿用原始字体名；目录就绪后用 OS/2 Unicode range 建立主导脚本粗候选池，再用字体 cmap 对当前 run 的实际 code point 做全覆盖判断。精确 family 已安装但 cmap 不覆盖正文时同样不能强行命中；OS/2 漏报某个 block 时不能否定 cmap 的真实字形。
- FontCatalogQueryService 是面向插件的只读事实入口：`checkFamily` 按规范化 family 精确检查，`listFamilies` 按脚本稳定排序、去重、过滤点号前缀的系统内部 UI 字体、限制 1–100 项并以 offset 分页。查询结果只包含 family、脚本候选、regular/bold/italic 和 monospace，不暴露 file path、PostScript name、face index 或缓存信息。
- 完整应用由 platform runtime effect 配置默认字体解析与查询；独立 backend 进程必须持有 `SystemFontResolutionRuntime`，等待同一份 catalog 扫描完成后再执行业务，并在进程生命周期结束时 dispose。只创建 `SystemFontCatalogQueryRuntime` 不能让默认排版解析器就绪。
- `resolvedFamily` 是渲染/测量应使用的字体声明，`fontFamily/request.family` 是 PPTX 导出必须保留的原始声明。
- 替换打分只表达“谁更接近”，不锁定绝对分数；候选 PANOSE 的 `0/Any` 与非正 `xAvgCharWidth` 是低置信 metadata，必须计入罚分，不能被当作零差异。请求 family 已安装但缺少当前字形时，仍必须用该 family 中最接近请求样式的 face 作为相似度参考，不能退回通用脚本基线。只要存在 bold/italic 完全匹配且 cmap 覆盖正文的 face，就只能在该样式集合内继续比较；样式不匹配的 face 只在没有匹配样式时参与选择。
- 原始请求字体名和解析后的字体名要同时保留：渲染/测量使用解析结果，PPTX 导出继续写原始字体名。
- OS/2 Unicode Range 只用于 `latin`、`eastAsian`、`complex` 候选池。bit 60 是 Private Use Area，不属于 CJK。最终覆盖事实来自 fontkit `characterSet` 压缩后的 cmap 闭区间；FontCatalog cache v4 持久化这些区间，不持久化字体文件本体。
- macOS 点号前缀 family 是系统内部 UI 实现：精确请求仍可查询安装事实，但不能进入 AI 设计列表或缺失字体替代池。
- 对外样式只承诺当前 metadata 与排版链已稳定表达的 regular、bold、italic；数值字重不在当前查询合同内。

## 验证入口

- 确定性查询与解析测试使用可注入 catalog，并包含 Heiti SC 标点漏报与 regular/bold 竞争语料：`pnpm exec vitest run src/features/font-resolution packages/plugins/slides/src/backend/engine/text/__tests__/font-resolution-integration.test.ts`。
- 真实系统目录与浏览器渲染 smoke：`pnpm --dir packages/plugins/slides run smoke:raster-worker`。该命令从当前机器分别读取 Latin / East Asian 候选，只使用候选明确返回的 regular+bold 样式，把主题字体经 deck.js、RenderModel 和共享文本布局送入 Electron raster worker，并检查中英文文本产生可见 PNG 像素。
- 真实 smoke 只能证明“当前机器的候选可进入完整渲染链”，不能把 OS/2 脚本候选提升为某种自然语言的完整字形覆盖证明。
