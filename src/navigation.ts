export type EntryView = "landing" | "workspace";
export type AuthIntent = "signup" | "signin";
export function entryIntent(
  platform: string,
  href?: string,
): { view: EntryView; auth?: AuthIntent } {
  if (platform !== "web" || !href) return { view: "workspace" };
  try {
    const url = new URL(href);
    if (url.searchParams.get("signup") === "1")
      return { view: "landing", auth: "signup" };
    if (url.searchParams.get("signin") === "1")
      return { view: "landing", auth: "signin" };
    const callback =
      url.searchParams.has("code") ||
      url.searchParams.has("mailbox_connected") ||
      url.searchParams.has("mailbox_error") ||
      /(?:access_token|refresh_token|error_description)=/.test(url.hash);
    return {
      view:
        callback ||
        url.searchParams.get("view") === "workspace" ||
        url.pathname === "/app"
          ? "workspace"
          : "landing",
    };
  } catch {
    return { view: "landing" };
  }
}
export function viewUrl(href: string, view: EntryView): string {
  const url = new URL(href);
  url.searchParams.delete("signup");
  url.searchParams.delete("signin");
  if (view === "workspace") url.searchParams.set("view", "workspace");
  else url.searchParams.delete("view");
  if (view === "landing" && url.pathname === "/app") url.pathname = "/";
  url.hash = "";
  return url.pathname + url.search + url.hash;
}
