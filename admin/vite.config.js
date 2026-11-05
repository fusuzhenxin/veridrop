import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const sitePublic = fileURLToPath(new URL("../public/", import.meta.url));
const icons = new Set([
  "/favicon.ico",
  "/img/icon-48.png",
  "/img/icon-96.png",
  "/img/favicon-32.png",
  "/img/favicon-16.png",
  "/img/apple-touch-icon.png",
]);

const types = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

function siteIcons() {
  return {
    name: "site-icons",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        let file = "";
        if (icons.has(path)) file = join(sitePublic, ...path.slice(1).split("/"));
        else if (path.startsWith("/media/prizes/")) {
          const name = path.slice("/media/prizes/".length);
          if (!/^[\w.-]+$/.test(name)) return next();
          file = join(sitePublic, "media", "prizes", name);
        } else return next();
        if (!existsSync(file)) return next();
        const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: process.env.OPS_BASE || "/",
  plugins: [siteIcons(), vue()],
  server: {
    port: 5180,
    proxy: {
      "/api": "http://127.0.0.1:4180",
      "/go": "http://127.0.0.1:4180",
    },
  },
});
