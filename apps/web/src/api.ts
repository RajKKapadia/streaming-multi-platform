export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({ error: "The server could not be reached." }));
  if (!response.ok) throw new Error(result.error ?? "The request failed.");
  return result as T;
}
export function studioPath(id: string, suffix: string, access?: string) {
  return `/studios/${id}/${suffix}${access ? `?access=${encodeURIComponent(access)}` : ""}`;
}
