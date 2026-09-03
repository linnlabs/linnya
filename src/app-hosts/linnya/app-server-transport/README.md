# App Server Transport

这里仅放 lifecycle、bootstrap 与 RPC 共同需要的 framing 原语，不拥有任何业务方法或生命周期。
当前 JSONL decoder 在拼接前按原始 bytes 执行调用方给定的单帧上限，失败后永久关闭；各上层协议仍各自拥有
schema、pending 容量、writer 背压、错误语义和 composition owner。
