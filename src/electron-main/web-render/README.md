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
取消决定和异常拒绝；真实 Electron 夹具还核对挑战页被取消后脚本与子资源请求为 0、普通 202 仍正常渲染。
真实 Electron 夹具入口为 `pnpm run test:web-render:electron`，不依赖外部站点。
