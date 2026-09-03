export const DESKTOP_EXTERNAL_AUTHORIZATION_BROWSER_OPEN_RPC_METHOD =
  'desktop.external_authorization_browser.open' as const;

export interface ExternalAuthorizationBrowserOpenRpcRequest {
  readonly url: string;
}
