const DEFAULT_TELEGRAM_BASE_URL = "https://t.me";
const SUPPORTED_TELEGRAM_HOSTS = new Set(["t.me", "telegram.me"]);

function normalizeTelegramBaseUrl(value: string | undefined): string {
  const rawValue = value?.trim() || DEFAULT_TELEGRAM_BASE_URL;

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`Invalid TELEGRAM_BASE_URL: ${rawValue}`);
  }

  if (
    url.protocol !== "https:" ||
    !SUPPORTED_TELEGRAM_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("TELEGRAM_BASE_URL must be either https://t.me or https://telegram.me");
  }

  return url.origin;
}

function isSupportedTelegramHost(hostname: string): boolean {
  return SUPPORTED_TELEGRAM_HOSTS.has(hostname.toLowerCase());
}

function rebaseTelegramUrl(value: string, telegramBaseUrl: string): string {
  const source = new URL(value, `${telegramBaseUrl}/`);
  return `${telegramBaseUrl}${source.pathname}${source.search}${source.hash}`;
}

export {
  DEFAULT_TELEGRAM_BASE_URL,
  isSupportedTelegramHost,
  normalizeTelegramBaseUrl,
  rebaseTelegramUrl,
};
