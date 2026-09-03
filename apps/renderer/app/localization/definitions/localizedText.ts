export type MessageParamValue = string | number;
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

export type LocalizedText =
  | string
  | {
      readonly key: string;
      readonly fallback: string;
      readonly params?: MessageParams;
    };
