const params = new URLSearchParams(window.location.hash.slice(1));
const freshToken = params.get("token");
if (freshToken) {
  sessionStorage.setItem("hyperbench.token", freshToken);
  history.replaceState(null, "", location.pathname + location.search);
}
export function authHeaders() {
  return {
    Authorization: `Bearer ${sessionStorage.getItem("hyperbench.token") || ""}`,
  };
}
export async function call<T>(
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/api/call", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : body.error?.message || "The request could not be completed.",
    );
  return body.result as T;
}
export interface Config {
  dataDir: string;
  cliPath: string;
  nodePath: string;
  version: string;
}
export async function getConfig(): Promise<Config> {
  const response = await fetch("/api/config", { headers: authHeaders() });
  if (!response.ok)
    throw new Error(
      "Workspace access expired. Open the URL printed by hyperbench start.",
    );
  return response.json();
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const bytes = (count: number) =>
  count < 1024
    ? `${count} B`
    : count < 1024 ** 2
      ? `${Math.round(count / 1024)} KB`
      : `${(count / 1024 ** 2).toFixed(1)} MB`;
