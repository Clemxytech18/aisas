import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const result = spawnSync(
  process.execPath,
  ["node_modules/expo/bin/cli", "export", "--platform", "web"],
  {
    stdio: "inherit",
    env: { ...process.env, EXPO_NO_TELEMETRY: "1" },
  },
);
if (result.status !== 0) process.exit(result.status || 1);
const { expo } = JSON.parse(readFileSync("app.json", "utf8"));
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const tags = [
  `<meta name="description" content="${escape(expo.web.description)}">`,
  `<meta property="og:title" content="${escape(expo.web.name)}">`,
  `<meta property="og:description" content="${escape(expo.web.description)}">`,
  '<meta property="og:type" content="website">',
  '<meta name="theme-color" content="#0A100F">',
];
const html = readFileSync("dist/index.html", "utf8");
writeFileSync(
  "dist/index.html",
  html.replace("</head>", `${tags.join("\n")}\n</head>`),
);
