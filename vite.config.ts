import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { AppService, FileSecrets } from "./apps/desktop/main/service.ts";
import type { Operation } from "./packages/contracts/index.ts";

function localPreview(): Plugin {
  return {
    name: "fable-local-preview",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        "script-src 'self'",
        "script-src 'self' 'unsafe-inline'",
      );
    },
    async configureServer(server) {
      const directory = path.resolve(".fable-dev");
      // This bridge exists only in the loopback development server. Packaged builds use isolated IPC.
      const secrets = new FileSecrets(
        path.join(directory, "dev-secrets.json"),
        (s) => Buffer.from(s).toString("base64"),
        (s) => Buffer.from(s, "base64").toString(),
      );
      await secrets.load();
      const app = new AppService(
        directory,
        secrets,
        undefined,
        path.resolve(process.env.FABLE_DEV_VAULT ?? ".fable-dev/personal"),
      );
      await app.initialize();
      server.httpServer?.once("close", () => {
        void app.close();
      });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        if (!url.pathname.startsWith("/api/")) return next();
        if (
          !["127.0.0.1:5173", "localhost:5173"].includes(req.headers.host ?? "")
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        if (url.pathname === "/api/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
          });
          res.write(": connected\n\n");
          const listener = (e: unknown) =>
            res.write(`data: ${JSON.stringify(e)}\n\n`);
          app.on("event", listener);
          res.write(
            `data: ${JSON.stringify({ type: "vault", state: app.vault.state })}\n\n`,
          );
          const timer = setInterval(() => res.write(": keepalive\n\n"), 20000);
          res.on("close", () => {
            clearInterval(timer);
            app.off("event", listener);
          });
          return;
        }
        if (url.pathname === "/api/asset" && req.method === "GET") {
          try {
            const p = url.searchParams.get("path") ?? "";
            const file = await app.vault.safePath(p);
            const { promises: fs } = await import("node:fs");
            const bytes = await fs.readFile(file);
            res.setHeader(
              "Content-Security-Policy",
              "default-src 'none'; sandbox",
            );
            const ext = path.extname(file);
            res.setHeader(
              "Content-Type",
              (
                {
                  ".png": "image/png",
                  ".jpg": "image/jpeg",
                  ".jpeg": "image/jpeg",
                  ".webp": "image/webp",
                  ".gif": "image/gif",
                  ".pdf": "application/pdf",
                  ".svg": "image/svg+xml",
                  ".avif": "image/avif",
                } as Record<string, string>
              )[ext] ?? "application/octet-stream",
            );
            res.end(bytes);
          } catch {
            res.writeHead(404);
            res.end();
          }
          return;
        }
        if (
          url.pathname !== "/api/rpc" ||
          req.method !== "POST" ||
          req.headers["x-fable-request"] !== "1"
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 70 * 1024 * 1024)
              throw new Error("This request is too large.");
          }
          const { operation, args } = JSON.parse(body);
          const result = await app.request(operation as Operation, args);
          const state =
            /^(documents\.(create|save|metadata|rename|trash|preserveDraft)|projects\.(create|update)|tasks\.|changes\.apply|history\.undo)/.test(
              operation,
            )
              ? app.vault.state
              : undefined;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ result, state }));
        } catch (e: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: e.message, code: e.code ?? "VALIDATION" }),
          );
        }
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), localPreview()],
  optimizeDeps: {
    include: [
      "@react-pdf/renderer",
      "@react-pdf/layout",
      "@react-pdf/font",
      "pdfkit",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/.fable-dev/**",
        "**/artifacts/**",
        "**/out/**",
        "**/.vite/**",
      ],
    },
  },
  build: { outDir: "dist/renderer", emptyOutDir: true },
  base: "./",
});
