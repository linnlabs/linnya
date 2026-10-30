/**
 * CRT 的有效签名既可能使用微软公司证书，也可能使用微软兼容性发布证书。
 * 后者已用于 Visual Studio 2022 的正式 redist；不能因此跳过 Windows 验签或接受任意发布者。
 * 这里只判断已验签证书的发布者，调用方仍必须要求 Authenticode status=Valid。
 */
function isMicrosoftVcRuntimePublisher(subject) {
  return typeof subject === 'string'
    && /^CN=(?:Microsoft Corporation|Microsoft Windows Software Compatibility Publisher), O=Microsoft Corporation(?:,|$)/.test(subject);
}

module.exports = { isMicrosoftVcRuntimePublisher };
