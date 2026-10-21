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

## 验证

`WebPageRenderWorker.test.ts` 覆盖窗口生命周期、跨站阻断、取消和超时；
`functions/isAllowedRenderNavigation.test.ts` 覆盖注册域、私有后缀、伪造后缀和危险地址；
`electronWebPageRenderRuntime.test.ts` 在 session 请求边界验证主框架逐次 DNS 准入。
真实 Electron 夹具入口为 `pnpm run test:web-render:electron`，不依赖外部站点。
