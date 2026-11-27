/** plugin_cli 工具卡的展示数据：命令行是 `linnya-<插件> <参数…>`，与 Linnya Shell 里运行同一命令的写法一致。 */
export type PluginCliPresentationData =
  | {
      readonly kind: 'lifecycle';
      /** 运行中参数可能尚不完整；读不出时不显示命令行。 */
      readonly commandLine?: string;
    }
  | {
      readonly kind: 'completed';
      readonly commandLine: string;
      /** 插件 stdout；JSON 报告已缩进成多行，后面接 stderr。 */
      readonly output: string;
    };
