# 本地网页渲染

Electron Main 实现 Web 领域的 `WebPageRenderer` 窄 port，使用独立临时 session 和隐藏窗口取得 DOM。
它不复用主窗口的登录态，不提供浏览器自动化，也不绕过验证码或登录要求。
Web 的读取阶梯、正文质量和来源合同见 [`Web README`](../../tools/web/README.md)。

## 导航与请求准入

主框架导航只允许 HTTP(S)、无 URL 用户名/密码，并留在请求 URL 的同一注册域。
`isAllowedRenderNavigation` 使用 `tldts` 的 Public Suffix List，包括私有后缀，因而允许
`www.example.com → example.com` 和多层后缀下的同站跳转；不把不同 `github.io` 等托管租户合并。
IP、localhost 和跨注册域导航拒绝。`about:blank` 只保留窗口初始化用途；弹窗仍一律拒绝。

站点相同不等于已经取得网络准入。Session 的 `onBeforeRequest` 对每次主框架请求（含重定向）
重新调用既有 URL/DNS policy，不复用之前同主机的准入结果。子资源沿用会话内既有的主机解析缓存，
每次渲染清理 storage 时同步清空。DNS 准入不是 Chromium socket 地址钉扎，不宣称消除所有 DNS 竞争窗口。
每个任务结束销毁窗口，worker 只复用隔离 session；取消、超时和渲染进程退出仍由同一 worker 管理。

## 加载与就绪

主框架 DOMContentLoaded（`dom-ready`）即开始采样，`load` 事件只是信号之一：图片等子资源拖住 load 时不再使整页
失败，`load_timeout` 只表示 `loadTimeoutMs` 内连 DOM 都没有就绪。错误页同样会触发 `dom-ready`，只有已观察到主文档
响应才算本页就绪。采样经 `webContents.mainFrame.executeJavaScript` 执行，因为 `webContents.executeJavaScript`
会挂起到页面停止加载；每次采样与最终 DOM 提取各受 `renderTimeoutMs` 约束。

就绪由 `functions/assessRenderReadiness` 判断：可见正文（`innerText`）稳定后，页面已完成、xhr/fetch 全部结束并安静
`RENDER_DATA_QUIET_MS`，或 DOM 就绪后已等满 `maxSettleDelayMs` 即可提取；仍有数据请求在途时在该窗口内继续等待。
前端应用壳（与静态抽取 js_shell 同阈值：可见文字少于 200 且脚本不少于 3）空白稳定不算就绪，要等正文出现；
已发出的数据请求全部结束并安静后仍为空壳，或到截止仍为空壳，报告 `app_shell_not_rendered`，不提取空壳 DOM。
没有应用壳迹象的空白页沿用快速路径返回，由 Web 抽取判定空正文。截止时间沿用既有预算：
`max(导航开始 + loadTimeoutMs, DOM 就绪 + maxSettleDelayMs)`，整体仍受任务总墙钟约束，不全局延长固定等待。

数据请求只经 session 的 `onSendHeaders/onCompleted/onErrorOccurred` 观察 xhr 类型（Chromium 把 fetch 也归为 xhr），
按请求 id 只结算本任务发出的请求；不拦截、不读取请求或响应内容。

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
真实 Electron 夹具入口为 `pnpm run test:web-render:electron`，不依赖外部站点。
