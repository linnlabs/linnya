export type DependencyLicenseDisposition = 'resolved' | 'public-blocker';

export interface DependencyLicenseFileEvidence {
  readonly relativePath: string;
  readonly sha256: string;
}

export interface DependencyLicenseEvidence {
  readonly packageName: string;
  readonly versions: readonly (string | null)[];
  readonly disposition: DependencyLicenseDisposition;
  readonly license: string | null;
  readonly source: string;
  readonly integrity?: string;
  readonly licenseFile?: DependencyLicenseFileEvidence;
}

/**
 * 这里只登记 package manifest 漏标、但已经取得精确版本证据的例外，以及尚未解除的公开阻断项。
 * 新版本必须重新核权，禁止只按 package name 继承旧结论。
 */
export const ROOT_DEPENDENCY_LICENSE_EVIDENCE = [
  {
    packageName: 'stubborn-utils',
    versions: ['1.0.1'],
    disposition: 'resolved',
    license: 'MIT',
    source: 'https://github.com/fabiospampinato/stubborn-utils',
    integrity:
      'sha512-bwtct4FpoH1eYdSMFc84fxnYynWwsy2u0joj94K+6caiPnjZIpwTLHT2u7CFAS0GumaBZVB5Y2GkJ46mJS76qg==',
    licenseFile: {
      relativePath: 'license',
      sha256: '0cb826ec0d67e9918daeb89ac839aba3b85cfd7579ee96208b1d81bef46593fd',
    },
  },
] as const satisfies readonly DependencyLicenseEvidence[];
