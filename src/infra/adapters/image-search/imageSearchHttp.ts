/**
 * 开放图片接口的请求标识。Wikimedia 要求自动化客户端带可识别的产品名与联系地址，
 * 否则可能被限流；Openverse 匿名请求按 IP 限额，同样带上产品标识。
 */
export const IMAGE_SEARCH_USER_AGENT = 'Linnya/1.0 (+https://linnya.com)';
