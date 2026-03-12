export function buildRelayResponsesUrl(baseUrl: string | undefined, toolSlug: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  const trimmedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmedBaseUrl}/v1/tools/${encodeURIComponent(toolSlug)}/responses`;
}
