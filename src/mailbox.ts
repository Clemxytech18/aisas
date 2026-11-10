/** Mailbox authorization is separate from AISAS account signup/sign-in. */
export function mailboxConnectUrl(config: {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  provider: string;
}): string {
  const providers: Record<string, string> = {
    google: "google",
    microsoft: "microsoft",
    yahoo: "yahoo",
    imap: "generic",
  };
  if (!Object.hasOwn(providers, config.provider))
    throw new Error("Choose a supported email provider.");
  const url = new URL("/v3/connect/auth", config.baseUrl);
  const params: Record<string, string> = {
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "online",
    state: config.state,
    provider: providers[config.provider],
  };
  // IMAP/Yahoo hosted credentials are user-owned; require a sending configuration.
  if (["imap", "yahoo"].includes(config.provider))
    params.options = "smtp_required";
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.href;
}
