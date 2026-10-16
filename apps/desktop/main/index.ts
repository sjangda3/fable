import squirrelStartup from "electron-squirrel-startup";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  safeStorage,
  shell,
  clipboard,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AppService, FileSecrets } from "./service.ts";
import {
  createVaultKey,
  encryptPayload,
  decryptPayload,
} from "../../../packages/sync/crypto.ts";
import type {
  Operation,
  Operations,
} from "../../../packages/contracts/index.ts";

if (squirrelStartup) app.quit();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "fable",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "fable-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let window: BrowserWindow | undefined;
let service: AppService;
let closing = false,
  closePending = false,
  quitting = false;
let shutdownComplete = false;
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
async function openExternal(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Only web links can be opened externally.");
  await shell.openExternal(url.href);
}
function trusted(
  sender: Electron.WebContents,
  frame: Electron.WebFrameMain | null,
) {
  return (
    sender === window?.webContents &&
    frame === sender.mainFrame &&
    frame?.url.startsWith("fable://app/")
  );
}
async function createWindow() {
  closing = false;
  closePending = false;
  const saved = await fs
    .readFile(path.join(app.getPath("userData"), "window.json"), "utf8")
    .then(JSON.parse)
    .catch(() => ({}));
  window = new BrowserWindow({
    width: Math.max(960, Math.min(Number(saved.width) || 1324, 2560)),
    height: Math.max(640, Math.min(Number(saved.height) || 1040, 1800)),
    minWidth: 960,
    minHeight: 640,
    title: "Fable",
    backgroundColor: "#ffffff",
    show: false,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : {
          titleBarOverlay: {
            color: "#ffffff",
            symbolColor: "#777777",
            height: 40,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("fable://app/")) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, done) => done(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once("ready-to-show", () => window?.show());
  window.on("close", (event) => {
    if (closing) return;
    event.preventDefault();
    if (!closePending) {
      closePending = true;
      window?.webContents.send("fable:before-close");
    }
  });
  window.on("closed", () => {
    window = undefined;
    if (quitting || process.platform !== "darwin") app.quit();
  });
  await window.loadURL("fable://app/");
  if (process.env.FABLE_SMOKE === "1") {
    const result = await window.webContents.executeJavaScript(
      `(async()=>{for(let i=0;i<100&&!document.querySelector('h1');i++)await new Promise(resolve=>setTimeout(resolve,20));return {title:document.title,heading:document.querySelector('h1')?.textContent,bridge:!!window.fable,platform:window.fable?.platform,state:!!(await window.fable?.request('vault.state',undefined)),sandbox:typeof require==='undefined'};})()`,
    );
    const key = await createVaultKey(),
      encrypted = await encryptPayload(
        key,
        { test: "desktop" },
        "desktop-smoke",
      ),
      decrypted = await decryptPayload<{ test: string }>(
        key,
        encrypted,
        "desktop-smoke",
      );
    result.encryption = decrypted.test === "desktop";
    if (process.env.FABLE_SMOKE_PROVIDERS === "1") {
      result.providers = (await service.providers.list()).map((p) => ({
        id: p.id,
        installed: p.installed,
        authMode: p.authMode,
        models: p.models.length,
      }));
    }
    console.log("FABLE_DESKTOP_SMOKE", JSON.stringify(result));
    closing = true;
    quitting = true;
    app.quit();
  }
}
app.on("before-quit", (event) => {
  quitting = true;
  if (window && !closing) {
    event.preventDefault();
    window.close();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!window && service) void createWindow();
});
app
  .whenReady()
  .then(async () => {
    process.env.FABLE_INDEXER_WORKER = path.join(__dirname, "index-worker.cjs");
    nativeTheme.themeSource = "light";
    const renderer = path.join(app.getAppPath(), "dist/renderer");
    protocol.handle("fable", async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== "app") return new Response(null, { status: 403 });
        const relative = decodeURIComponent(
          url.pathname === "/" ? "/index.html" : url.pathname,
        );
        const file = path.resolve(renderer, "." + relative);
        if (!file.startsWith(renderer + path.sep))
          return new Response(null, { status: 403 });
        return new Response(await fs.readFile(file), {
          headers: {
            "Content-Type":
              mime[path.extname(file)] || "application/octet-stream",
          },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    protocol.handle("fable-asset", async (request) => {
      try {
        const url = new URL(request.url),
          relative = url.searchParams.get("path") || "";
        if (
          url.hostname !== "vault" ||
          !/^image\//.test(mime[path.extname(relative).toLowerCase()] || "")
        )
          return new Response(null, { status: 403 });
        const file = await service.vault.safePath(relative);
        return new Response(await fs.readFile(file), {
          headers: {
            "Content-Type": mime[path.extname(file).toLowerCase()],
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    const data =
      process.env.FABLE_SMOKE === "1"
        ? path.join(app.getPath("temp"), "fable-desktop-smoke")
        : app.getPath("userData");
    const secrets = new FileSecrets(
      path.join(data, "secrets.json"),
      (value) => {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error(
            "OS credential encryption is unavailable. Local work remains available.",
          );
        return safeStorage.encryptString(value).toString("base64");
      },
      (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    );
    await secrets.load();
    service = new AppService(
      data,
      secrets,
      {
        async chooseFolder() {
          const result = await dialog.showOpenDialog(window!, {
            properties: ["openDirectory", "createDirectory"],
            title: "Choose your Markdown folder",
          });
          return result.canceled ? null : result.filePaths[0];
        },
        async chooseAttachment() {
          const result = await dialog.showOpenDialog(window!, {
            properties: ["openFile"],
            filters: [
              {
                name: "Images, PDFs, and text",
                extensions: [
                  "png",
                  "jpg",
                  "jpeg",
                  "gif",
                  "webp",
                  "avif",
                  "svg",
                  "pdf",
                  "txt",
                  "csv",
                ],
              },
            ],
          });
          if (result.canceled) return null;
          const file = result.filePaths[0];
          return { name: path.basename(file), bytes: await fs.readFile(file) };
        },
        async reveal(file) {
          shell.showItemInFolder(file);
        },
        openURL: openExternal,
        async openFile(file) {
          const error = await shell.openPath(file);
          if (error) throw new Error(error);
        },
      },
      process.env.FABLE_SMOKE === "1"
        ? path.join(data, "Example vault")
        : undefined,
    );
    service.on("event", (event) => {
      if (window && !window.isDestroyed())
        window.webContents.send("fable:event", event);
    });
    await service.initialize();
    ipcMain.handle(
      "fable:request",
      async (
        event,
        operation: Operation,
        args: Operations[Operation]["input"],
      ) => {
        if (!trusted(event.sender, event.senderFrame))
          return { error: "Untrusted application frame.", code: "VALIDATION" };
        try {
          return { result: await service.request(operation, args) };
        } catch (e: any) {
          return {
            error: e.message || "The operation failed.",
            code: e.code || "FILESYSTEM",
          };
        }
      },
    );
    ipcMain.handle("fable:external", async (event, url: string) => {
      if (!trusted(event.sender, event.senderFrame) || typeof url !== "string")
        throw new Error("Untrusted link.");
      await openExternal(url);
    });
    ipcMain.handle("fable:copy", (event, text: string) => {
      if (
        !trusted(event.sender, event.senderFrame) ||
        typeof text !== "string" ||
        text.length > 1024 * 1024
      )
        throw new Error("Invalid clipboard request.");
      clipboard.writeText(text);
    });
    ipcMain.on("fable:close-ready", (event, saved: boolean) => {
      if (!trusted(event.sender, event.senderFrame) || !closePending) return;
      closePending = false;
      if (saved === true) {
        closing = true;
        const bounds = window?.getBounds();
        void fs
          .writeFile(
            path.join(app.getPath("userData"), "window.json"),
            JSON.stringify(bounds || {}),
          )
          .finally(() => window?.close());
      } else quitting = false;
    });
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "New Note",
            accelerator: "CmdOrCtrl+N",
            click: () => window?.webContents.send("fable:shortcut", "new-note"),
          },
          { type: "separator" },
          {
            label: "Close Tab",
            accelerator: "CmdOrCtrl+W",
            click: () =>
              window?.webContents.send("fable:shortcut", "close-tab"),
          },
          { role: "close", accelerator: "CmdOrCtrl+Shift+W" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "togglefullscreen" },
          ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Fable documentation",
            click: () => {
              void shell.openPath(path.join(app.getAppPath(), "README.md"));
            },
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    await createWindow();
  })
  .catch((error) => {
    console.error("Fable could not start:", error.message);
    app.exit(1);
  });
app.on("will-quit", (event) => {
  if (shutdownComplete || !service) return;
  event.preventDefault();
  void service?.close().finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});
