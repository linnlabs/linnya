import type { ConversationFileLocator } from '@app/schemas';

/** CLI 只管理当前项目已有知识库；检索继续使用现有知识库工具。 */
export type KnowledgeCliCommand =
  | { readonly action: 'list' }
  | { readonly action: 'documents.list'; readonly kbId: string }
  | {
      readonly action: 'documents.import';
      readonly kbId: string;
      readonly source: ConversationFileLocator;
    }
  | { readonly action: 'documents.delete'; readonly kbId: string; readonly documentId: string }
  | { readonly action: 'index.status'; readonly kbId: string }
  | { readonly action: 'index.rebuild'; readonly kbId: string }
  | { readonly action: 'unlink'; readonly kbId: string };

export type KnowledgeCliParseResult =
  | { readonly kind: 'help' }
  | { readonly kind: 'command'; readonly command: KnowledgeCliCommand };

export const KNOWLEDGE_CLI_HELP = `Linnya knowledge
  linnya-knowledge list
  linnya-knowledge documents list --kb <id>
  linnya-knowledge documents import --kb <id> --source conversation:/<file>
  linnya-knowledge documents delete --kb <id> --document <id>
  linnya-knowledge index status --kb <id>
  linnya-knowledge index rebuild --kb <id>
  linnya-knowledge unlink --kb <id>

仅操作当前项目关联的知识库；无关联时 default 仅可读取。
导入、删除资料和重建索引需要显式读写关联；unlink 仅解除当前项目关联，不删除知识库。
导入只接收当前对话的 conversation:/ 文件；模型由父运行的用途配置决定，不接受模型参数。
写操作还须通过父 Shell 的写入权限与内部数据访问授权。
退出码：0 成功，2 参数错误，77 权限不足，130 已取消；其他错误返回非零。
`;
