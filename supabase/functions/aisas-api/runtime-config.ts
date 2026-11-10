/** Server-only configuration. Never import this module into the Expo application. */
export const CONFIG_KEYS = [
  "OPENAI_API_KEY",
  "ZEROBOUNCE_API_KEY",
  "OPENAI_MODEL",
  "SERPAPI_KEY",
  "NYLAS_API_KEY",
  "NYLAS_CLIENT_ID",
  "NYLAS_CLIENT_SECRET",
  "CRON_SECRET",
  "APP_ORIGIN",
  "NYLAS_REDIRECT_URI",
] as const;
export class RuntimeConfig {
  private cached: Record<string, string> = {};
  private expires = 0;
  private loading: Promise<void> | undefined;
  constructor(
    private environment: (key: string) => string | undefined,
    private now = () => Date.now(),
  ) {}
  async load(fetchConfig: () => Promise<Record<string, string>>) {
    if (this.now() < this.expires) return;
    if (!this.loading)
      this.loading = (async () => {
        const values = await fetchConfig();
        this.cached = Object.fromEntries(
          CONFIG_KEYS.filter(
            (k) => typeof values[k] === "string" && values[k].length > 0,
          ).map((k) => [k, values[k]]),
        );
        this.expires = this.now() + 60_000;
      })().finally(() => {
        this.loading = undefined;
      });
    await this.loading;
  }
  optional(key: string): string | undefined {
    return this.environment(key) || this.cached[key];
  }
  get(key: string): string {
    const value = this.optional(key);
    if (!value)
      throw new Error(
        `Integration not configured: ${key}. Ask your workspace administrator to complete setup.`,
      );
    return value;
  }
}
