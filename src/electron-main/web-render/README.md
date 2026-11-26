# 本地网页渲染

Electron Main 实现 Web 领域的 `WebPageRenderer` 窄 port，使用独立临时 session 和隐藏窗口取得 DOM。
它不复用主窗口的登录态，不提供浏览器自动化，也不绕过验证码或登录要求。
Web 的读取阶梯、正文质量和来源合同见 [`Web README`](../../tools/web/README.md)。

## 导航与请求准入

主框架初次导航提交前（`did-navigate` 之前）收到的服务端 HTTP 重定向（`will-redirect`）在满足最多 5 跳与公共可解析注册域准入（拒绝 IP、localhost、凭据与危险协议）时放行，逐跳仍执行 session `onBeforeRequest` URL/DNS 准入；初次提交后即锚定到提交地址，后续导航与提交后跳转仅允许留在同一注册域。
`isAllowedRenderNavigation` 使用 `tldts` 的 Public Suffix List，包括私有后缀，因而允许
`www.example.com → example.com` 和多层后缀下的同站跳转；不把不同 `github.io` 等托管租户合并。
IP、localhost 和跨注册域导航拒绝。`about:blank` 只保留窗口初始化用途；弹窗仍一律拒绝。

站点相同不等于已经取得网络准入。Session 的 `onBeforeRequest` 对每次主框架请求（含重定向）
重新调用既有 URL/DNS policy，不复用之前同主机的准入结果。子资源沿用会话内既有的主机解析缓存，
每次渲染清理 storage 时同步清空。DNS 准入不是 Chromium socket 地址钉扎，不宣称消除所有 DNS 竞争窗口。
`WebPageRenderManager` 按槽位使用有界固定 partition（默认 `web-render:slot-0`、`web-render:slot-1`），
由 `createSlotRenderSession` 按槽位生命周期安装一次安全守卫与响应/子资源观察器，空闲期间（无活跃任务）
主响应观察默认拒绝；Worker 空闲销毁时只销毁窗口并清理 storage/cache，不卸载槽位安全守卫，也不按随机
UUID 无限创建底层 Chromium session。槽位清理完成后直接唤醒最早仍在排队的请求，等待者取消不会中断交接；取消、超时和渲染进程退出仍由当前活跃 Worker 管理。

## 加载与就绪、受控滚动与浏览器内采集

主框架 DOMContentLoaded（`dom-ready`）即开始采样，`load` 事件只是信号之一：样式表等子资源拖住 load 时不再使整页
失败，`load_timeout` 只表示 `loadTimeoutMs` 内连 DOM 都没有就绪。错误页同样会触发 `dom-ready`，只有已观察到主文档
响应才算本页就绪。采样、受控滚动与 DOM 采集经 `webContents.mainFrame.executeJavaScript` 执行（`webContents.executeJavaScript`
会挂起到页面停止加载）；单次脚本受 `renderTimeoutMs` 与任务总截止约束，保证滚动与最终采集留有余地。

- **重资源拦截**：默认 `blockHeavyResources = true`，窗口启用 `webPreferences.images = false` 禁止 Blink 加载图片且不触发 `img.onerror`（即使在严格 CSP 下也不丢失 `<img onerror>` 图片候选），同时在 `onBeforeRequest` 取消 `image`、`media` 与 `font` 请求作纵深防护；`observeSubresources` 会过滤 `Accept: text/event-stream` 的 SSE 连接，不让长连接阻塞就绪。
- **主区感知就绪**：`render-capture` 脚本返回 `mainTextLength`（与 Web 共用语义噪音选择器，排除导航、侧栏、页脚、弹窗及 `position: fixed/sticky` 的外围浮层，存在明确 `<main>`/`<article>` 时不将外围导航计入，并穿透开放 Shadow DOM 与同源 `iframe`）。`functions/assessRenderReadiness` 只把主区高水位有效增长视作进展：主区达到 800 字且高水位静默 `RENDER_MAIN_QUIET_MS`（700ms）后立即提取（不受轮询与数字跳动拖死）；未达 800 字时允许在 8 秒就绪上限内继续等待数据请求或主区增长；空白应用壳到截止或已观察到数据请求且数据、脚本和样式表均安静后仍为空壳则报 `app_shell_not_rendered`。正文未达 800 字、只是文字暂时不变时，脚本或样式表请求仍在途或结束不足 `RENDER_PAGE_LOAD_QUIET_MS`（500ms）就继续等（`wait_page_load_in_flight`）：经 JSONP 或后续脚本取数的列表页不会在数据到达前被提取；等待仍受 3 秒安定上限约束，挂住的统计脚本不会拖过上限。
- **受控轻量滚动**：首屏高度大于视口时按最多 4 步、单次滚动阶段不超过 3 秒、主区达 150,000 字即停的三重硬刹车增量向下滚动；固定高度的列表在滚动后更换首行时，回到起始位置后采集并标记 `lazy_content_incomplete`。普通单屏或无增量页面立即结束，因硬刹车停止且仍有增量或未到底时在采集结果中附带 `lazy_content_incomplete`。
- **四步只读采集**：在离线克隆副本中按“① 先判可见登录/人机遮罩 → ② 保护明确关联的可展开折叠正文与 `<details>` → ③ `slot.assignedNodes({ flatten: true })` 展平开放 Shadow DOM、内联同源 `iframe` 并按子文档基址解析相对路径，包含浏览器允许父文档读取的 `srcdoc` → ④ 计算样式剪枝（保留 `opacity: 0`）与 `data-src` 等懒加载图回填”执行，结果经 `parseBrowserCapturePayload` 严格校验，异常或格式非法时记录告警并安全回退 `document.documentElement.outerHTML`。
- **定位元素的归属**：`fixed/sticky` 不等于外围。`sticky` 的表格单元格与行、标题、位于表格内或包住表格的容器是正文（固定表头、固定列、吸顶小标题）；占视口宽高各六成以上且承载页面一半以上文字的 `fixed/sticky` 容器是单页应用的界面本体。其余才按外围浮层从就绪采样和采集结果中排除。
- **访问屏障要真的挡住正文**：主区不足 500 字时，可见的验证码或密码框直接判屏障；主区充足时，只有位于浮层内、且视口 3×3 采样点多数落在浮层上才判 `captcha` / `login_required`。`.grecaptcha-badge`（reCAPTCHA v3 角标）不算验证码，角落登录卡、吸顶登录条不算登录墙。
- **采集上限**：单次采集最多克隆 200,000 个节点、嵌套 256 层，触达时停止深入并附带 `capture_truncated`；内联 SVG 整体跳过，图形里的文字不进正文。

子资源只经 session 的 `onSendHeaders/onCompleted/onErrorOccurred` 观察：xhr 类型（Chromium 把 fetch 也归为 xhr，已排除 SSE）
按请求 id 只结算本任务发出的数据请求，失败与成功均结束在途计时；失败额外记录为 `dataRequestFailures`，
与脚本/样式表的 `subresourceFailures` 分开。两类均只统计失败次数并保留首个合法 `net::ERR_*` 错误名，
窗口销毁或导航中止的 `net::ERR_ABORTED` 不计入，不记录地址；重复或前一任务迟到的数据终态不重复计数。
每个任务结束后清空计数。失败事实随 `load_timeout`、`load_failed` 与
`app_shell_not_rendered` 回传。不拦截、不读取请求或响应内容。
这只是传输失败事实，不断言该请求属于正文接口或已经导致正文缺失；HTTP 错误响应和 JSON 解析失败不属于本计数。
正常取得正文的页面不会仅因附属请求失败而被拒绝。

主框架加载被拒绝时以 `load_failed` 结束，并保留 Electron 错误对象上的数值 net 错误码（如 `-107`、`-20`）；
任意 Chromium 错误文字不跨进程传递。

## 主响应与访问挑战

Session 的 `onHeadersReceived` 在响应正文交给页面前观察每个主框架响应，只回传状态码和 Web 规则声明的
挑战判定头（`x-amzn-waf-action`、`cf-mitigated`，值按上限裁剪），不复制 Cookie 或其他响应头。成功结果必须带有
实际观察到的主响应；没有观察到时报告 `render_failed`，不补造 200。

挑战判定只调用 Web 领域的 `detectWebAccessChallengeHeader`，Electron 不维护第二套规则。命中时同步取消该响应，
再以 `access_challenge` 结束任务并销毁窗口，挑战页脚本和子资源不运行；不等待、求解或绕过挑战，也不按域名特判。
观察者异常或没有进行中的任务时同样拒绝主文档。

## 验证

`WebPageRenderWorker.test.ts` 覆盖窗口生命周期、跨站阻断、取消和超时；
`functions/isAllowedRenderNavigation.test.ts` 覆盖注册域、私有后缀、伪造后缀和危险地址；
`electronWebPageRenderRuntime.test.ts` 在 session 请求边界验证主框架逐次 DNS 准入，以及主框架响应头观察、
取消决定和异常拒绝，以及数据请求观察；`functions/assessRenderReadiness.test.ts` 覆盖就绪规则边界。
真实 Electron 夹具还核对挑战页被取消后脚本与子资源请求为 0、普通 202 仍正常渲染，以及受控延迟页面：延迟数据的应用壳
取得正文、拖住 load 的图片不致整页失败、数据请求不结束或已结束仍为空的应用壳报告未渲染、无脚本空页快速返回。
另用真实 fetch 与 XMLHttpRequest 的连接断开验证失败事实经 Provider 进入恢复建议，不再提示重复读取无效；
并覆盖渲染端长 403 错误页不写入正文、提交前跨站 302 重定向成功与提交后脚本跨站跳转拦截、隐藏主区容器渲染揭示、
以及 Manager 在 `idleTimeoutMs` 回收重建 Worker 后只创建一次槽位 session 且私有回环地址准入守卫依然生效。
真实 Electron 夹具入口为 `pnpm run test:web-render:electron`，不依赖外部站点。
