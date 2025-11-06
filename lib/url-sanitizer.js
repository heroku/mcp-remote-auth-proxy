/**
 * Sensitive OAuth query parameters that should be redacted from logs
 */
const SENSITIVE_PARAMS = new Set([
  'client_id',
  'code_challenge',
  'code_challenge_method',
  'state',
  'redirect_uri',
  'code',
]);

/**
 * Sanitizes a URL by removing sensitive OAuth query parameters.
 * This prevents sensitive data like client_id, code_challenge, state, etc.
 * from being logged.
 *
 * @param {string} urlString - The URL string to sanitize
 * @returns {string} - The sanitized URL with sensitive query parameters removed
 */
export function sanitizeUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return urlString || '';
  }

  try {
    // Handle relative URLs (pathname + query string)
    // If it doesn't start with http:// or https://, treat as relative
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      // Parse as relative URL
      const urlObj = new URL(urlString, 'http://placeholder');
      const sanitizedParams = sanitizeQueryParams(urlObj.searchParams);
      // Only add ? if there are remaining params
      return sanitizedParams ? `${urlObj.pathname}?${sanitizedParams}` : urlObj.pathname;
    }

    // Parse absolute URL
    const urlObj = new URL(urlString);
    const sanitizedParams = sanitizeQueryParams(urlObj.searchParams);
    urlObj.search = sanitizedParams || '';

    // Return the sanitized URL
    return urlObj.toString();
  } catch {
    // If URL parsing fails, try to sanitize query string manually
    // This handles edge cases like malformed URLs
    const queryIndex = urlString.indexOf('?');
    if (queryIndex === -1) {
      return urlString; // No query string, return as-is
    }

    const pathname = urlString.substring(0, queryIndex);
    const queryString = urlString.substring(queryIndex + 1);
    const sanitizedParams = sanitizeQueryString(queryString);

    return pathname + (sanitizedParams ? `?${sanitizedParams}` : '');
  }
}

/**
 * Sanitizes URLSearchParams by removing sensitive parameters
 *
 * @param {URLSearchParams} searchParams - The search params to sanitize
 * @returns {string} - The sanitized query string
 */
function sanitizeQueryParams(searchParams) {
  const params = [];
  for (const [key, value] of searchParams.entries()) {
    if (!SENSITIVE_PARAMS.has(key)) {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return params.length > 0 ? params.join('&') : '';
}

/**
 * Sanitizes a raw query string by removing sensitive parameters
 * Used as fallback for malformed URLs
 *
 * @param {string} queryString - The raw query string to sanitize
 * @returns {string} - The sanitized query string
 */
function sanitizeQueryString(queryString) {
  if (!queryString) {
    return '';
  }

  const params = queryString.split('&');
  const sanitized = params
    .map((param) => {
      const equalIndex = param.indexOf('=');
      let key;
      if (equalIndex === -1) {
        // Parameter without value
        key = param;
      } else {
        key = param.substring(0, equalIndex);
      }
      try {
        const decodedKey = decodeURIComponent(key);
        if (SENSITIVE_PARAMS.has(decodedKey)) {
          return null; // Remove sensitive param
        }
      } catch {
        // If decoding fails, check the raw key
        if (SENSITIVE_PARAMS.has(key)) {
          return null; // Remove sensitive param
        }
      }
      return param; // Keep non-sensitive param
    })
    .filter((param) => param !== null);

  return sanitized.length > 0 ? sanitized.join('&') : '';
}

