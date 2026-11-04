# 文字视觉 oracle

本目录只用于 Electron 开发探针，不进入插件/Host 的生产入口。它比较同一次运行中、同字体/DPR下的 DOM、HTML-in-Canvas 与 Pixi，验证缺字、裁切、错位和作者颜色；不跨操作系统要求字体逐像素相等。

`collectVisualTextLayout.ts` 在字体准备完成后采集 reference 及刚完成 paint、尚未 dispose 的真实 staging clone。`Intl.Segmenter` 仅划分验收区域，Range 使用其 UTF-16 index/length；不拆开 emoji、组合字符或重做字体塑形。报告保存实际字簇矩形、逐行盒、computed 字体/样式与加载事实。KaTeX 的辅助 MathML 由其现有裁切样式隐藏，不当作可见文字；可见 HTML 字形和图形仍接受像素检查。

`compareVisualTextPixels.ts` 保留局部墨迹、质量、质心与实色内核。所有正例都执行逐簇/逐行检查，即使旧 raw95 通过也不跳过。原 `inkIou`、`pixiIou`、raw95、尺寸、作者红色和 ghost 保留率继续输出；raw95 是原始诊断值，不是用户规定的 Windows 容差。

AA 分类复用 [pixelmatch 7.1.0](https://github.com/mapbox/pixelmatch/tree/v7.1.0)，固定 threshold=0、includeAA=false，不采用其 .1 或 Playwright .2 默认颜色阈值。它的局部梯度判断只提供 AA 候选，不自动证明字体正确。形状残差按前景 union 归一化，颜色由真实实色内核独立检查。文字 Range 外不享受 AA 豁免；RGB/alpha 通道差超过8即失败，不按白底面积稀释。Pixi 的范围沿既有正文比较原则排除独立纸边/阴影，正文范围内的空隙仍严格检查。

Windows Chromium 150 的系统 LCD 字体与透明 Canvas 的灰阶 AA 可以不同，参见[Windows 字体创建](https://github.com/chromium/chromium/blob/150.0.7871.250/third_party/blink/renderer/platform/fonts/win/font_platform_data_win.cc)、[Canvas surface 属性](https://github.com/chromium/chromium/blob/150.0.7871.250/third_party/blink/renderer/platform/graphics/canvas_resource_provider.cc)。本 oracle 不修改生产样式、不强制灰阶，不自动对齐或缩放图像来掩盖错位。

当前候选界限由 `definitions.ts` 唯一拥有：排版误差0.125物理像素、前景与背景通道对比24、质心误差0.5物理像素、墨迹质量比0.7–1.35、字簇/行非AA结构残差0.2/0.05、实色通道差8及90%内核保留。数字在 GPU 采集前固定；Node 通过不表示 Windows 已校准。真实同环境正负例若失败，先留下完整证据并解释，不扩大界限制造通过。

`applyVisualNegative.ts` 只损坏独立反例的实际光栅源 DOM，reference 和原正例 PNG 不改。固定反例是缺一个汉字、标点、emoji，末行裁切，一物理像素位移，错误字号，红字变蓝，以及文字区域之外的黑条。`verifyVisualTextNegatives.ts` 要求每个反例分别被 raster/Pixi 的像素检查拒绝；metadata 不同不能代算像素拒绝。全部反例及正例的字体、DPR、内容与字形几何资格必须匹配。

normal visual 先保存所有有效捕获的正负例 PNG、paint clone metadata 和逐区域报告，最后汇总 failedCases 失败；尺寸、范围、Renderer 退出或未知异常立即传播，不补空白。缺少新 metadata 的旧 PNG 只能诊断，不能补造合格结论。CPU Skia 的少量业务检查只验证拒绝规则，真实 Windows/DOM/GPU 资格来自独立采集结果。

pixelmatch 是 Canvas 的精确 devDependency，随包 [LICENSE](https://github.com/mapbox/pixelmatch/blob/v7.1.0/LICENSE) 与 npm manifest 为 ISC；其 pngjs 7.0.0 依赖为 MIT。版本与 registry integrity 在 pnpm lock 固定，许可证由现有 pnpm license/Source BOM 链核对，不复制第三方算法或扩大生产依赖图。
