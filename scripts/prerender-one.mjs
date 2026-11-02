import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const route = process.argv[2] || "/list";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const mod = await server.ssrLoadModule("/src/html-snapshot.js");
const app = await server.ssrLoadModule("/src/entry-server.jsx");
const cssName = "index-m2KTkFgU.css";
const jsName = "index-CW2JnjkZ.js";
const template = `<!doctype html><html><head><link rel="stylesheet" crossorigin href="/assets/${cssName}"></head><body><div id="root"></div><script type="module" crossorigin src="/assets/${jsName}"></script></body></html>`;
let community = null;
try {
  community = JSON.parse(fs.readFileSync(path.join(root, "data", "community.json"), "utf8"));
} catch {
  community = null;
}
const page = mod.renderSnapshot(route, community);
page.markup = app.renderPage(route, { static: true, community });
const html = mod.injectSnapshot(template, page);
const dir = path.join(root, "dist", route.replace(/^\//, ""));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "index.html"), html);
console.log(JSON.stringify({ route, bytes: html.length, hasAd: html.includes("aruhub.com/sign-up") }));
await server.close();
process.exit(0);
