# 文字卡编辑会话

正文草稿、保存屏障和编辑声明由本 feature 拥有。连续保存使用同一个 historyGroupId；新输入与组合输入不会被迟到保存清除。正文与自动高度共同进入正式用户提交，失败保留本地正文。

`createCanvasCardEditor` 拥有打开世代、活动声明与草稿结束，`createCanvasCardSave` 拥有串行保存及回执接纳。保存捕获调用时的草稿和声明，通过编辑器提供的当前性判断决定能否结束；保存模块不能自行切换活动卡片或释放其他打开请求的声明。

`open(elementId, historyGroupId?, signal?)` 支持 Renderer 本地 AbortSignal。每次调用都有独立打开世代；保存/声明返回后再次确认当前请求、文档与卡片状态，再装入草稿。取消正常返回，不通过异常清除已经保存的草稿；打开成功后不继续监听 opening signal，后续结束仍经过保存屏障。

每次实际打开使用唯一 text:<UUID> owner。保护维护按该会话续约与释放，旧请求的 finally 不会释放后来打开同一张卡的保护。session关闭已由统一claim层reset并关闭Host视图，迟到请求不向新文档补发旧释放。

释放RPC期间切回原卡或继续输入时，旧finish不清除草稿，并恢复仍活动会话自己的保护；suspend/dispose先使活动会话失效，迟到结果不能反向续约。创建、等待精确位图及Page导航由表面编排拥有，本feature不操作相机或新增UI锁。
