const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export const sanitizeUserUrl = (rawValue?: string | null) => {
  const trimmedValue = String(rawValue || '').trim();
  if (!trimmedValue) {
    return '';
  }

  if (trimmedValue.startsWith('/') || trimmedValue.startsWith('#')) {
    return trimmedValue;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol) ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
};
