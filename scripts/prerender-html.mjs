import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
});
const mod = await server.ssrLoadModule("/src/html-snapshot.js");
const app = await server.ssrLoadModule("/src/entry-server.jsx");
const assetNames = fs.readdirSync(path.join(root, "dist", "assets"));
const cssName = assetNames.find((name) => name.startsWith("index-") && name.endsWith(".css"));
const jsName = assetNames.find((name) => name.startsWith("index-") && name.endsWith(".js"));
if (!cssName || !jsName) throw new Error("dist/assets is missing the built stylesheet or script");
const template = `<!doctype html><html><head><link rel="stylesheet" crossorigin href="/assets/${cssName}"></head><body><div id="root"></div><script type="module" crossorigin src="/assets/${jsName}"></script></body></html>`;
const paths = mod.snapshotPaths();
let community = null;
try {
  community = JSON.parse(fs.readFileSync(path.join(root, "data", "community.json"), "utf8"));
} catch {
  community = null;
}
console.log(JSON.stringify({ routes: paths.length }));
let written = 0;
let failed = 0;
for (const route of paths) {
  const page = mod.renderSnapshot(route, community);
  if ((page.status || 200) === 200) {
    try {
      page.markup = app.renderPage(route, { static: true, community });
    } catch (error) {
      failed += 1;
      console.log(JSON.stringify({ failed: route, message: error.message }));
    }
  }
  const html = mod.injectSnapshot(template, page);
  const dir = route === "/" ? path.join(root, "dist") : path.join(root, "dist", route.replace(/^\//, ""));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  written += 1;
  if (written % 100 === 0) console.log(JSON.stringify({ written, route }));
}
await server.close();
console.log(JSON.stringify({ written, failed }));
