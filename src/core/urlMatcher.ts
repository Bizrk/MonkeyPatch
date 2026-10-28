// Matches a URL against one or more Chrome match patterns, wildcard globs, or comma/newline-separated patterns.
export function matchesUrlPattern(urlStr: string, pattern: string): boolean {
  if (!pattern || !urlStr) return false;

  // Support comma-separated or newline-separated multi-patterns (e.g. "https://kiss18.vip/*, https://*.hdrama.net/*")
  if (pattern.includes(',') || pattern.includes('\n')) {
    const subPatterns = pattern
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return subPatterns.some((sub) => matchesSingleUrlPattern(urlStr, sub));
  }

  return matchesSingleUrlPattern(urlStr, pattern);
}

function matchesSingleUrlPattern(urlStr: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed === '<all_urls>' || trimmed === '*') return true;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    return false;
  }

  // Allow shorthand domain/path patterns without scheme (e.g. "*.hdrama.net/series/*" -> "*://*.hdrama.net/series/*")
  const normalizedPattern = /^(\*|https?|file|ftp):\/\//i.test(trimmed)
    ? trimmed
    : `*://${trimmed.includes('/') ? trimmed : `${trimmed}/*`}`;

  // Standard scheme://host/path pattern
  const match = /^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)?$/i.exec(normalizedPattern);
  if (!match) {
    // Fallback simple wildcard match against full URL
    return wildcardToRegExp(trimmed).test(urlStr);
  }

  const [, schemePattern, hostPattern, pathPattern = '/*'] = match;

  // 1. Check scheme
  const actualScheme = parsedUrl.protocol.replace(':', '').toLowerCase();
  if (schemePattern === '*') {
    if (actualScheme !== 'http' && actualScheme !== 'https') return false;
  } else if (schemePattern.toLowerCase() !== actualScheme) {
    return false;
  }

  // 2. Check host (and optional port)
  const hasPortInPattern = hostPattern.includes(':');
  const targetHostValue = hasPortInPattern
    ? parsedUrl.host.toLowerCase()
    : parsedUrl.hostname.toLowerCase();

  if (hostPattern !== '*') {
    if (hostPattern.startsWith('*.')) {
      const baseDomain = hostPattern.slice(2).toLowerCase();
      if (targetHostValue !== baseDomain && !targetHostValue.endsWith('.' + baseDomain)) {
        return false;
      }
    } else if (!wildcardToRegExp(hostPattern.toLowerCase()).test(targetHostValue)) {
      return false;
    }
  }

  // 3. Check path + query
  const fullPathAndQuery = parsedUrl.pathname + parsedUrl.search;
  if (
    !wildcardToRegExp(pathPattern).test(fullPathAndQuery) &&
    !wildcardToRegExp(pathPattern).test(parsedUrl.pathname)
  ) {
    return false;
  }

  return true;
}

export function patchMatchesUrl(patterns: string[], urlStr: string): boolean {
  return patterns.some((p) => matchesUrlPattern(urlStr, p));
}

function wildcardToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}
