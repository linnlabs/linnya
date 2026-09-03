export type ShellWorkingDirectoryFileSystemOperation = 'realpath' | 'stat' | 'access';

export type ShellWorkingDirectoryFileSystemResult =
  | {
      readonly status: 'resolved';
      readonly canonicalPath: string;
    }
  | {
      readonly status: 'not_found' | 'not_directory' | 'denied' | 'failed';
      readonly osCode?: string;
      readonly operation: ShellWorkingDirectoryFileSystemOperation;
    };

/** 只暴露 cwd 解析需要的目录事实，不让 Commands 直接依赖 Node fs 或平台错误对象。 */
export interface ShellWorkingDirectoryFileSystemPort {
  resolveDirectory(absolutePath: string): Promise<ShellWorkingDirectoryFileSystemResult>;
}
