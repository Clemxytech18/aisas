// Static preview of the exported web app; accepts the managed preview's host/port flags.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const args = process.argv.slice(2);
const arg = (key, fallback) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = resolve("dist");
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
http
  .createServer(async (req, res) => {
    try {
      let path = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403);
        return res.end();
      }
      try {
        if ((await stat(path)).isDirectory())
          path = resolve(path, "index.html");
      } catch {
        path = resolve(root, "index.html");
      }
      const data = await readFile(path);
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Build the web app with npm run build first.");
    }
  })
  .listen(Number(arg("--port", "8081")), arg("--host", "127.0.0.1"), () =>
    console.log(
      `Local: http://${arg("--host", "127.0.0.1")}:${arg("--port", "8081")}`,
    ),
  );
