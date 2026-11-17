/** 搜索分词复用 Host 的延迟词典实例；不暴露原生对象或索引配置。 */
export declare function tokenizeForSearch(text: string): Promise<string[]>;
