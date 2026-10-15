// Browser-safe integrity only; a matching hash is not a source/right approval.
export async function photoValueDigest(value: unknown, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const bytes = new TextEncoder().encode(JSON.stringify(value)), result = await crypto.subtle.digest('SHA-256', bytes);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  return `sha256:${Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
