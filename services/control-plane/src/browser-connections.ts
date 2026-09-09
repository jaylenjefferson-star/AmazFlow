export type BrowserConnectionInput = {
  name: string;
  baseUrl: string;
  allowedOrigins: string[];
  preferredMode: "auto" | "managed" | "connected";
};

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (/^(0|10|127|169\.254|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(host)) return true;
  return false;
}

function publicHttps(value: unknown, originOnly = false) {
  let url: URL;
  try { url = new URL(String(value ?? "")); } catch { throw new Error("must be a valid URL"); }
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHost(url.hostname)) throw new Error("must be a public HTTPS URL");
  if (originOnly && (url.pathname !== "/" || url.search || url.hash || url.origin !== String(value).replace(/\/$/, ""))) throw new Error("must be an HTTPS origin without a path, query, or fragment");
  return url;
}

export function validateBrowserConnectionInput(body: Record<string, unknown>): BrowserConnectionInput {
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) throw new Error("A connection name is required");
  let base: URL;
  try { base = publicHttps(body.baseUrl); } catch (error) { throw new Error(`baseUrl ${error instanceof Error ? error.message : "is invalid"}`); }
  const configured = Array.isArray(body.allowedOrigins) ? body.allowedOrigins : [base.origin];
  const allowedOrigins = [...new Set(configured.map((value) => {
    try { return publicHttps(value, true).origin; } catch (error) { throw new Error(`Allowed origin ${error instanceof Error ? error.message : "is invalid"}`); }
  }))];
  if (!allowedOrigins.includes(base.origin)) throw new Error("Allowed origins must include the base URL origin");
  if (allowedOrigins.length > 20) throw new Error("A connection can allow at most 20 origins");
  const preferredMode = body.preferredMode === "managed" || body.preferredMode === "connected" ? body.preferredMode : "auto";
  return { name, baseUrl: base.toString(), allowedOrigins, preferredMode };
}
