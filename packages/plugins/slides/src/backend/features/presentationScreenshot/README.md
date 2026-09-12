# Presentation Screenshot

本 feature 把同一版本的 `PresentationRenderModel` 发布为可供人、CLI 和 CI 消费的页面图片批次。它负责页选择、输出编码、staging、版本工作集和批次发布；页面资源物化、hidden worker 调用与 PNG 真实复核统一委托给 `presentationPageRasterization`，不再维护第二套栅格规则。

## 目录职责

```text
presentationScreenshot/
├── definitions/      # 请求、页选择、批次结果、稳定错误合同
├── functions/        # 页选择、文件名、受管版本身份和 JPEG 输出适配
├── infrastructure/   # staging、原子替换、版本退休与失败回滚
└── orchestration/    # 页面栅格、输出编码和整批发布编排
```

## 数据流

```text
PptCoordinator.renderScreenshots
  -> presentationQueryRuntime.getRenderModelSnapshot
  -> PresentationScreenshotRuntime（页选择与输出 session）
  -> PresentationPageRasterizationRuntime
  -> 本地文件 / PPTX embedded part / data URI 真实解码
  -> 自包含 SlideRasterRequest
  -> slides-raster hidden worker
  -> PNG bytes 真实解码、尺寸和 hash 复核
  -> lossless_png：直接 staging 已验证 PNG
     或 agent_review_jpeg：复核页面不透明、quality 90、4:4:4 JPEG
  -> 整批 publish
  -> 返回版本、页码与相对文件名
```

render model 与 `versionId/versionNumber/sourceKind` 必须来自同一次 query snapshot。禁止先调用 `getRenderModel()`、再独立查询 latest version 拼结果；并发保存会造成版本身份漂移。

单页 raster 输出统一限制为 4000 万物理像素。Agent/CLI 参数层尚未读取文稿比例，因此使用同一预算的正方形包络保守校验 `viewportWidthPx × pixelRatio`；runtime 加载 source 后按实际页面比例计算宽高并做精确门禁。参数层不能替代 runtime 复核，runtime 也不应重新散落像素常量。

## 资源边界

- worker 的普通图片只接收 `data:image/jpeg|png|webp;base64`。backend 在调用前读取同一份 bytes，并通过 host `@plugin/backend/imageInspection` 完成 magic、完整像素解码、尺寸、长度和 hash 复核。SVG Graphic 则随已授权 RenderModel 携带 admitted canonical SVG，由 worker 内的共享 adapter 形成自包含 `data:image/svg+xml`，不经过 raster image inspector，也不读取作者路径。
- hidden worker 对图片与 SVG Graphic 资源使用 strict preload：任一背景图、图片或 SVG Graphic 节点在浏览器解码阶段失败时，整页返回 `slides.raster.resource_load_failed`，不能用 placeholder 发布成功 PNG。普通交互预览仍可显示 placeholder，二者通过显式策略区分。
- generated deck 的绝对本地路径与 data URI 可以物化；imported/patched deck 的相对 part 从该版本 PPTX package 内读取，并限制在 `ppt/`。
- 远程 HTTP(S) 图片首版明确失败。screenshot feature 不自行 fetch，避免引入 SSRF、网络漂移和缓存语义；需要远程图片时应由上游受控资产导入流程先形成受信本地副本。
- 不复用 engine 旧 `imagePrefetch` 作为可信检验。该链服务 PPTX 编译兼容，仍有按后缀猜 MIME与远程失败降级语义，不符合截图批次的完整性合同。

## 输出类型

- `lossless_png` 直接发布页面栅格化返回的已验证 PNG，用于视觉回归和内部无损消费者。
- `agent_review_jpeg` 是 PNG 的下游页面级适配：页面背景必须已由共享 renderer 覆盖完整画布，Host `@plugin/backend/imageTranscoding` 复核没有真实透明像素后再以 quality 90、4:4:4 编码。禁止在转码层猜测白底，否则会掩盖页面 renderer 的透明像素回归。该策略只服务 Agent 像素检查，不改变 hidden worker、用户逐页图片导出、SVG fallback 或图表透明图的 PNG 合同。
- 转码继续受单页 4000 万像素门禁约束。插件只选择明确策略，不直接依赖 Host 内部 Sharp 实现。

## 输出与失败语义

- 文件名固定为 `slide-NNN.png` 或 `slide-NNN.jpg`，不使用 title，避免路径注入和跨平台字符漂移。
- renderer 图片诊断只记录来源类型、长度和是否为绝对路径，不记录 data URI 片段或真实路径。
- page raster 的确定性 `invalid_request` 保留为 `slides.screenshot.invalid_request`，连同原页码和
  codec 生成的安全字段路径返回调用方；不得退化成 `render_failed`。未知异常仍使用固定安全文案。
- 所有请求页先在最终目录之外的 staging 目录完成。任一页失败时 staging 整体删除；成功页子集不能泄漏成可消费结果。
- 全部页面完成后才按已知文件名发布；替换已有页面时先把旧文件移入本批 staging，发布途中失败或取消会删除新文件并恢复旧文件。
- runtime 只有整批发布完成后才返回成功结果。CLI 再把结果中的相对文件名转换为 `conversation:` 或 `file:` locator 并写 stdout，因此进程成功终态就是调用方可消费这批图片的边界，不需要额外持久化提交标记。
- 显式 `directory` 输出中，`overwrite=false` 在本次任一页文件存在时拒绝；`overwrite=true` 只替换本次确定的文件，不扫描或清理目录中的其他用户文件。
- `latest_version` 输出按 `version-<number>-<id-hash>/profile-<profile-hash>/` 发布。同版本同 profile 的局部 render 只替换所选页；新版本整批成功后淘汰所有更低版本，哪怕新批次只选了一页。更高版本已经成功时，晚到的旧版本明确返回 `slides.screenshot.stale_version`。
- version 目录首次出现时通过目录 rename 整体发布；staging 目录不符合 version 命名，不会被并发任务误认为成功版本。不使用 manifest、数据库行或“当前版本”指针文件。

## 测试

- 页选择与文件名：`functions/resolveScreenshotSlideNumbers.test.ts`
- 页面图片物化：`../presentationPageRasterization/orchestration/materializePresentationPage.test.ts`
- 整批发布与失败回滚：`orchestration/PresentationScreenshotRuntime.test.ts`
- 真实 Electron worker + orchestration：`pnpm --dir packages/plugins/slides run smoke:raster-worker`；该门禁分别覆盖 linear background、radial shape fill、linear line stroke、组合 Paint 页面、真实系统 Latin / East Asian 候选形成的中英文文本 PNG，以及最终批次发布。
