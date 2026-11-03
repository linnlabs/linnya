export interface SourceCheckoutIdentity {
  readonly root: string;
  /** 源码快照可能没有 Git，detached HEAD 也没有分支；不能伪造 main。 */
  readonly branch: string | null;
}
