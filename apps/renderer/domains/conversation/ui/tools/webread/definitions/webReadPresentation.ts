export type WebReadPresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly target?: string;
    }
  | {
      readonly kind: 'page';
      readonly title: string;
      readonly url: string;
      readonly charCount: number;
      readonly truncated: boolean;
      readonly snippet: string;
      readonly publishedAt?: string;
      readonly author?: string;
    };
