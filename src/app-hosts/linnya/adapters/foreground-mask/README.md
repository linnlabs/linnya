# Foreground Mask Adapter

实现 image-processing domain 的 `ForegroundMaskPort`：在 macOS 14 及以上用系统 Vision 的前景实例遮罩（`VNGenerateForegroundInstanceMaskRequest`）给照片去背。去背的规则、判别数与回退见 [image-processing domain](../../../../domains/image-processing/README.md#去背cutout)。

## 怎么调起 Vision

用 `/usr/bin/osascript -l JavaScript` 执行一段固定的 JXA 脚本，经 ObjC 桥调 Vision 和 Core Image，不随包带可执行文件。

- 与随包的 Swift 小程序调用的是同一个系统接口，结果一样；不用在打包时编译通用二进制，不进签名、公证和签名校验清单，开发机与 CI 也不需要 Swift 工具链。
- 代价是每次多约 0.1 秒的 osascript 启动；整次去背（含解码与编码）0.24–0.74 秒。
- 可用性按 `process.platform` 与 Darwin 主版本（23 即 macOS 14）判断，不可用时不起进程。

## 边界

- 输入 JPEG 写进系统临时目录下的独立目录，输出 PNG 读回后整个目录删除；路径只经 argv 传给脚本，不拼进脚本文本。
- 脚本 stdout 一行 `{"instances":N}`，N 为 0 表示没找到前景，不写输出。脚本出错时 osascript 以非 0 退出，返回 `failed`；错误信息里的临时目录替换掉，不把本机路径交给模型。
- 超时 60 秒；取消信号会结束 osascript 子进程。
