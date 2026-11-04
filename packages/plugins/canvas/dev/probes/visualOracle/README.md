# 文字视觉 oracle

本目录只用于 Electron 开发探针，不进入插件/Host 的生产入口。它比较同一次运行中、同字体/DPR下的 DOM、HTML-in-Canvas 与 Pixi，验证缺字、裁切、错位和作者颜色；不跨操作系统要求字体逐像素相等。

`collectVisualTextLayout.ts` 在字体准备完成后采集 reference 及刚完成 paint、尚未 dispose 的真实 staging clone。`Intl.Segmenter` 仅划分验收区域，Range 使用其 UTF-16 index/length；不拆开 emoji、组合字符或重做字体塑形。报告保存实际字簇矩形、逐行盒、computed 字体/样式与加载事实。KaTeX 的辅助 MathML 由其现有裁切样式隐藏，不当作可见文字；可见 HTML 字形和图形仍接受像素检查。

原生列表 `::marker` 不属于 DOM Text/Range。它以独立 `geometryKind: marker-gutter` 保存真实li/ul矩形、首行Range、computed padding-inline-start与`::marker`样式，推导浏览器分配的marker槽，不冒充逐字簇边界。本固定夹具只接受ltr/outside/disc，未知布局保持失败。槽内仍有独立非空、质量、质心、实色和AA结构判定；槽外严格检查不变，另以真实“缺marker”损坏验证。它不是按已失败像素坐标加白名单。

layout元数据使用version3，区分Range与marker槽并记录真实字体长属性及availability query；早期version1/2原件不回填、不经双读fallback冒充新资格，复核时按其实际source commit解释。

原生`::marker`的`font-variant-numeric: tabular-nums`不能由CSS `font` shorthand表示，真实computed shorthand可以为空；[CSS Fonts规范](https://drafts.csswg.org/css-fonts-3/#font-prop)没有承诺所有长属性都可序列化为该简写。因此字体可用性查询始终从本元素的font-style/weight/size/family构成，原shorthand及variant/stretch等长属性仍保存，不使用shorthand或父字体回退。`fontAvailable`只是FontFaceSet查询事实，不能当作实际painted-face ID；同环境/字体样式资格与像素验证仍必须成立。

`compareVisualTextPixels.ts` 保留局部墨迹、质量、质心与实色内核。所有正例都执行逐簇/逐行检查，即使旧 raw95 通过也不跳过。原 `inkIou`、`pixiIou`、raw95、尺寸、作者红色和 ghost 保留率继续输出；raw95 是原始诊断值，不是用户规定的 Windows 容差。

AA 分类复用 [pixelmatch 7.1.0](https://github.com/mapbox/pixelmatch/tree/v7.1.0)，固定 threshold=0、includeAA=false，不采用其 .1 或 Playwright .2 默认颜色阈值。它的局部梯度判断只提供 AA 候选，不自动证明字体正确。非AA形状残差与通道差超过8的颜色残差均按前景 union 归一化，真实实色内核另行检查。文字 Range 外不享受 AA 豁免；RGB/alpha 通道差超过8即失败，不按白底面积稀释。Pixi 的范围沿既有正文比较原则排除独立纸边/阴影，正文范围内的空隙仍严格检查。

`monochromeTextModel.ts` 只给本固定夹具的精确已知family普通文字解释LCD→gray颜色差：request的system-ui、portable core的pre/code monospace，以及KaTeX0.18.10输出的`KaTeX_Math`和`KaTeX_Main, math, "Times New Roman", serif`。这些是本fixture的CSS family来源，不是任意字体白名单或实际painted-face ID。reference每通道须在同源computed前景/背景端点之间，actual须落在同一前景→背景的单一alpha线段内（通道误差仍≤8），两者均为实际不透明截图。完整grapheme含emoji/pictographic、旗帜、ZWJ、VS、keycap或潜在彩色序列时显式禁止；未知字体/资格也禁止。重叠Range中禁止资格优先，不能借邻字豁免彩色字形。emoji换色和丢色变灰都按真实非AA颜色残差拒绝，不靠CSS红色核。

字体来源分别见正式[正文排版入口](../../../src/renderer/hidden-render-worker/functions/createCardSurface.ts)、[portable core CSS](../../../../../markdown-document-core/src/style.css)与其[精确KaTeX依赖](../../../../../markdown-document-core/package.json)；采集metadata仍核对实际CSS family及字体查询事实，未来fixture出现新family不会自动获准。

comparison `oracleRevision: 2` 将统计模型分型：旧referenceMass/actualMass/massRatio/centroidDelta仍是原max-channel值，只作原始诊断；新`coverage`对合格单色字簇使用所有有效RGB通道的归一化alpha平均，未知/彩色字簇维持原contrast-max。行位置固定同一reference字簇权重，actual覆盖率变化不能把两列文字重新加权；没有图像移动、重对齐或滤镜。Microsoft [DirectWrite模式合同](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_1/ne-dwrite_1-dwrite_text_antialias_mode)明确LCD逐RGB覆盖与透明中间位图单alpha灰阶的区别；平均alpha是本oracle的跨模式统计权重，不声称重建Skia/ClearType rasterizer。

`oracleRevision: 3` 让结构决策也遵循同一逐像素资格：`structure.model`明确标为`per-pixel-qualified-rgb-mean`，只有已获单色资格且同源paint模型成立时，使用RGB平均alpha乘fg/bg最大通道对比，再与原24比较；未知、彩色、重叠冲突仍用严格max。每个像素只取一致的fg/bg身份，不能用首字颜色解释整行，也不能重复累加重叠Range稀释分母。行/簇的5%/20%结构门仅改读新`structure`，旧union/residual/residualRatio与max质量字段完整保留，不改旧原件或阈值。合法LCD弱fringe不再因单一通道跨24被误作缺笔画；真实reference墨迹被擦成背景仍是两侧ink不一致，即使alpha0符合paint线也必须接受非AA结构拒绝。颜色8、实色/峰值、质量/位置、文字范围外检查均不变。

Node回归同时覆盖合法fringe的黑/低对比前景、同行不同作者色、真实CPU字形横向擦笔画、已知字体小标点整擦、未知字体/emoji重叠禁止与既有全部损坏。色段矩阵只验证统计单位，不冒充真实字体/DOM/GPU资格；真实正负例仍须在相同字体/DPR环境重新验证。

作者色同时保存旧same-pixel `solidCoverage`；新`solidRoleCoverage`仍要求≥0.9，但验证的是reference core处actual仍有墨迹且颜色与原fg→bg线兼容，不能把正确AA覆盖变动误叫换色。reference有实色核时actual也必须仍出现真实fg实色峰，整体opacity0.8冲淡必须被这一峰值守卫拒绝。非AA结构/颜色残差、覆盖质量、逐簇位置、未知/emoji严格颜色检查均不能绕过，阈值没有扩大。

ghost守卫只验证线没有擦掉已经正确的body bitmap，以同一灰阶raster为源检查Kernel目标，原DOM `ghostPreservation`继续输出（其中含DOM↔gray AA差）。独立控制只给Kernel的body副本横向擦字，raster基线不动；必须由ghost守卫自己拒绝，不借文字oracle的失败。DOM与body位图排版/质量仍由前述oracle把关。

Windows Chromium 150 的系统 LCD 字体与透明 Canvas 的灰阶 AA 可以不同，参见[Windows 字体创建](https://github.com/chromium/chromium/blob/150.0.7871.250/third_party/blink/renderer/platform/fonts/win/font_platform_data_win.cc)、[Canvas surface 属性](https://github.com/chromium/chromium/blob/150.0.7871.250/third_party/blink/renderer/platform/graphics/canvas_resource_provider.cc)。本 oracle 不修改生产样式、不强制灰阶，不自动对齐或缩放图像来掩盖错位。

当前候选界限由 `definitions.ts` 唯一拥有：排版误差0.125物理像素、前景与背景通道对比24、质心误差0.5物理像素、墨迹质量比0.7–1.35、字簇/行非AA结构残差0.2/0.05、实色通道差8及90%内核保留。数字在 GPU 采集前固定；Node 通过不表示 Windows 已校准。真实同环境正负例若失败，先留下完整证据并解释，不扩大界限制造通过。

`applyVisualNegative.ts` 只损坏独立反例的实际光栅源 DOM，reference 和原正例 PNG 不改。固定反例是缺一个汉字、标点、emoji或列表marker，末行裁切，一物理像素位移，错误字号，红字变蓝、emoji换色/丢色，文字区域之外的黑条及整体opacity冲淡。`verifyVisualTextNegatives.ts` 要求每个反例分别被 raster/Pixi 的像素检查拒绝；metadata 不同不能代算像素拒绝。全部反例及正例的字体、DPR、内容与字形几何资格必须匹配。

normal visual 先保存所有有效捕获的正负例 PNG、paint clone metadata 和逐区域报告，最后汇总 failedCases 失败；尺寸、范围、Renderer 退出或未知异常立即传播，不补空白。缺少新 metadata 的旧 PNG 只能诊断，不能补造合格结论。CPU Skia 的少量业务检查只验证拒绝规则，真实 Windows/DOM/GPU 资格来自独立采集结果。

pixelmatch 是 Canvas 的精确 devDependency，随包 [LICENSE](https://github.com/mapbox/pixelmatch/blob/v7.1.0/LICENSE) 与 npm manifest 为 ISC；其 pngjs 7.0.0 依赖为 MIT。版本与 registry integrity 在 pnpm lock 固定，随包LICENSE及pnpm的dev license报告核验其许可。正式Source BOM使用production图，只用于确认这些开发包未进入生产依赖，不能冒称它已验证dev包许可；不复制第三方算法。
