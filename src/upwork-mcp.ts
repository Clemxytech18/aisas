import { UPWORK_MCP } from "./upwork.ts";
export type McpTool = {
  name: string;
  description?: string;
  inputSchema: any;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};
export function readableJobTool(t: McpTool) {
  const n = t.name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return (
    /job|feed|opportunit/.test(n) &&
    !/(?:^|[_\-.])(create|update|delete|submit|apply|send|save|remove|execute|mutate|write|hire|accept|reject|cancel)(?:$|[_\-.])/.test(
      n,
    ) &&
    t.annotations?.destructiveHint !== true &&
    (t.annotations?.readOnlyHint === true ||
      /(?:^|[_\-.])(search|get|list|fetch|read|find|browse)(?:$|[_\-.])/.test(
        n,
      ))
  );
}
export function selectJobTools(
  tools: McpTool[],
  kind: "feed" | "search" | "detail",
) {
  return tools
    .filter(readableJobTool)
    .filter((t) =>
      kind === "detail"
        ? /detail|(?:^|[_\-.])get(?:[_\-.])?(?:a[_\-.]?)?job(?:$|[_\-.])/i.test(
            t.name,
          )
        : kind === "feed"
          ? /feed|recommend|search|list|browse|find/i.test(t.name)
          : /search|find|browse/i.test(t.name),
    )
    .sort(
      (a, b) =>
        Number(kind === "feed" && /feed|recommend/i.test(b.name)) -
        Number(kind === "feed" && /feed|recommend/i.test(a.name)),
    )
    .slice(0, 6);
}
export function validateMcpArguments(
  v: any,
  s: any,
  root: any = s,
  depth = 0,
): boolean {
  if (depth > 30 || !s || typeof s !== "object") return false;
  if (s.$ref) {
    if (!s.$ref.startsWith("#/")) return false;
    const ref = s.$ref
      .slice(2)
      .split("/")
      .reduce(
        (x: any, k: string) => x?.[k.replace(/~1/g, "/").replace(/~0/g, "~")],
        root,
      );
    return !!ref && validateMcpArguments(v, ref, root, depth + 1);
  }
  if (
    s.allOf &&
    !s.allOf.every((x: any) => validateMcpArguments(v, x, root, depth + 1))
  )
    return false;
  if (
    s.anyOf &&
    !s.anyOf.some((x: any) => validateMcpArguments(v, x, root, depth + 1))
  )
    return false;
  if (
    s.oneOf &&
    s.oneOf.filter((x: any) => validateMcpArguments(v, x, root, depth + 1))
      .length !== 1
  )
    return false;
  if (
    s.enum &&
    !s.enum.some((x: any) => JSON.stringify(x) === JSON.stringify(v))
  )
    return false;
  if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(v))
    return false;
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (
      !types.some((t: string) =>
        t === "null"
          ? v === null
          : t === "array"
            ? Array.isArray(v)
            : t === "object"
              ? v !== null && typeof v === "object" && !Array.isArray(v)
              : t === "integer"
                ? Number.isInteger(v)
                : t === "number"
                  ? typeof v === "number" && Number.isFinite(v)
                  : typeof v === t,
      )
    )
      return false;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ((s.required || []).some((k: string) => !Object.hasOwn(v, k)))
      return false;
    for (const [k, x] of Object.entries(v)) {
      if (["__proto__", "constructor", "prototype"].includes(k)) return false;
      if (s.properties?.[k]) {
        if (!validateMcpArguments(x, s.properties[k], root, depth + 1))
          return false;
      } else if (s.additionalProperties === false) return false;
      else if (
        typeof s.additionalProperties === "object" &&
        !validateMcpArguments(x, s.additionalProperties, root, depth + 1)
      )
        return false;
    }
  }
  if (Array.isArray(v)) {
    if (
      v.length > 100 ||
      (s.maxItems !== undefined && v.length > s.maxItems) ||
      (s.minItems !== undefined && v.length < s.minItems)
    )
      return false;
    if (
      s.items &&
      !v.every((x) => validateMcpArguments(x, s.items, root, depth + 1))
    )
      return false;
  }
  if (typeof v === "string") {
    if (
      v.length > 20000 ||
      (s.maxLength !== undefined && v.length > s.maxLength) ||
      (s.minLength !== undefined && v.length < s.minLength)
    )
      return false;
    if (s.pattern)
      try {
        if (!new RegExp(s.pattern).test(v)) return false;
      } catch {
        return false;
      }
  }
  if (
    typeof v === "number" &&
    ((s.minimum !== undefined && v < s.minimum) ||
      (s.maximum !== undefined && v > s.maximum))
  )
    return false;
  return true;
}
export class UpworkMcp {
  private session = "";
  private version = "2025-03-26";
  private id = 0;
  constructor(
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async send(
    method: string,
    params: any,
    notification = false,
  ): Promise<any> {
    const id = ++this.id;
    const r = await this.fetcher(UPWORK_MCP, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
        "MCP-Protocol-Version": this.version,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(!notification ? { id } : {}),
        method,
        params,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.status === 401) throw new Error("upwork_reconnect");
    if (r.status === 403)
      throw new Error(
        "Upwork has not granted access to this operation. Check your account/API permissions.",
      );
    if (r.status === 429)
      throw new Error("Upwork rate limit reached. Please retry later.");
    if (!r.ok)
      throw new Error("Upwork MCP is temporarily unavailable. Please retry.");
    this.session = r.headers.get("Mcp-Session-Id") || this.session;
    if (notification) {
      await r.body?.cancel();
      return {};
    }
    // Consume JSON or SSE incrementally; some MCP servers keep the SSE connection open after the reply.
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Upwork returned an empty response.");
    let text = "";
    const decoder = new TextDecoder();
    let result: any;
    try {
      while (text.length < 1500000) {
        const next = await reader.read();
        if (next.done) {
          text += decoder.decode();
          break;
        }
        text += decoder.decode(next.value, { stream: true });
        if (r.headers.get("content-type")?.includes("text/event-stream")) {
          for (const block of text.split(/\r?\n\r?\n/).slice(0, -1)) {
            const data = block
              .split(/\r?\n/)
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            try {
              const v = JSON.parse(data);
              if (v.id === id) {
                result = v;
                break;
              }
            } catch {}
          }
          if (result) break;
        }
      }
      if (text.length >= 1500000)
        throw new Error("Upwork returned too much data. Narrow your search.");
      if (!result) {
        if (r.headers.get("content-type")?.includes("text/event-stream")) {
          for (const line of text
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:")))
            try {
              const v = JSON.parse(line.slice(5));
              if (v.id === id) result = v;
            } catch {}
        } else result = JSON.parse(text);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (!result || result.id !== id || result.error)
      throw new Error(
        "Upwork could not complete that request. Please retry or reconnect.",
      );
    return result.result;
  }
  async initialize() {
    const r = await this.send("initialize", {
      protocolVersion: this.version,
      capabilities: {},
      clientInfo: { name: "AISAS By ClemxyTech", version: "0.1.0" },
    });
    if (r.protocolVersion) this.version = r.protocolVersion;
    await this.send("notifications/initialized", {}, true);
  }
  async tools() {
    const all: McpTool[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await this.send("tools/list", cursor ? { cursor } : {});
      if (!Array.isArray(r.tools))
        throw new Error("Upwork did not return a tool catalog.");
      all.push(...r.tools);
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return all;
  }
  async call(tool: McpTool, args: any) {
    if (!readableJobTool(tool) || !validateMcpArguments(args, tool.inputSchema))
      throw new Error(
        "The requested Upwork operation is not a valid read-only job request.",
      );
    const r = await this.send("tools/call", {
      name: tool.name,
      arguments: args,
    });
    if (r.isError)
      throw new Error(
        "Upwork could not return these jobs. Adjust the search or reconnect.",
      );
    return r;
  }
}
