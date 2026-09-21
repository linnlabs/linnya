# System Keyring Credential Protection

本 adapter 是 Desktop 与独立 CLI Runtime 共用的系统凭据保护实现。它只负责取得当前 OS
用户 keyring 中的 32-byte master key，并以 Node `crypto` 的 AES-256-GCM 加解密业务密文；模型、
Provider Account 和插件仍各自拥有凭据文件与生命周期。

master key 的 keyring account 由规范化 AppData root 的 SHA-256 派生，因此只有指向同一 AppData
的 Desktop 与 CLI 会共享密文。业务文件保存带版本的 `linnya-keyring:v1:` envelope，不保存 keyring
密码、明文或环境变量 fallback。Desktop 可以创建 master key；CLI 只消费已有 key，缺失时明确报告
系统安全存储不可用，不能自行建立第二个信任根。

升级时 Desktop credential adapter 仍能读取旧 Electron `safeStorage` 密文，并通过 `rewrap` 让各业务
owner 在自己的文件事务中改写为当前 envelope。CLI 不实现旧 Chromium 密文算法；尚未经过新版
Desktop 初始化的旧密文返回 `migration_required`。迁移失败保留原文件与不可用状态，不能删除记录或
改用明文。

`@napi-rs/keyring` 是 N-API 平台 adapter。当前使用 2.x 的 `getSecret` 读取合同：原生层只把真正的
`NoEntry` 转成空值，钥匙串锁定、ACL 拒绝、歧义或其它存储错误保持为 rejected promise；写入仍使用
兼容旧版本的 password 形态，并在明确没有 secret 时回读旧 password 记录。
这一区分是安全边界：不能因为一次读取失败就把 Desktop 的 `allowMasterKeyCreation` 当成“缺失”而
生成第二把 master key，否则会让已有业务密文全部无法解密。

源码测试用内存 entry 验证密文、vault 隔离、损坏、缺失和拒绝读取，不访问开发者真实 keyring；正式
支持仍必须由 macOS/Windows 安装态分别验证原生包、首次授权、权限拒绝和 Desktop → CLI → Desktop
往返。macOS 上 Desktop 与独立 CLI 是不同的应用身份；CLI 首次访问现有 keychain item 可能需要用户
在系统提示中授权。授权未完成时应显示“系统安全存储暂时不可用”，不能显示成“密钥不存在”，也不
得自动重置或覆盖 master key。
