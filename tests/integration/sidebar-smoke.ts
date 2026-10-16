import { app, BrowserWindow, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { AppService } from "../../apps/desktop/main/service.ts";
import { documentFolder } from "../../packages/domain/index.ts";

// Runs the production renderer and real preload/service in an isolated temporary vault.
// HTML drag events are simulated here; this is not an OS mouse-gesture test.
void app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "fable-sidebar-smoke-"),
    ),
    service = new AppService(
      path.join(directory, "app"),
      { get: async () => undefined, set: async () => {} },
      undefined,
      path.join(directory, "vault"),
    );
  let nativeWindow: BrowserWindow | undefined;
  try {
    await service.initialize();
    const area = await service.vault.create("Drag check", "area"),
      first = await service.vault.create("First project", "project", area.id),
      second = await service.vault.create("Second project", "project", area.id),
      base = documentFolder(first);
    await service.vault.createFolder(first.id, "Alpha");
    await service.vault.createFolder(first.id, "Beta");
    const page = await service.vault.createPage(first.id, "Moving page"),
      other = await service.vault.createPage(first.id, "Another page");
    await service.vault.saveViews({
      ...(await service.vault.views()),
      selectedAreaId: area.id,
    });
    nativeWindow = new BrowserWindow({
      width: 1324,
      height: 1040,
      show: false,
      webPreferences: {
        preload: path.resolve(".vite/build/preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const renderer = nativeWindow.webContents;
    ipcMain.handle("fable:request", async (event, operation, args) => {
      if (event.sender !== renderer) throw new Error("Unexpected sender");
      try {
        return { result: await service.request(operation, args) };
      } catch (error: any) {
        return { error: error.message, code: error.code };
      }
    });
    service.on("event", (event) => {
      if (!renderer.isDestroyed()) renderer.send("fable:event", event);
    });
    await nativeWindow.loadFile(path.resolve("dist/renderer/index.html"));
    const result = await renderer.executeJavaScript(
      `(${async function fixture(ids: {
        area: string;
        first: string;
        second: string;
        page: string;
        other: string;
        base: string;
      }) {
        const pause = (ms = 30) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const wait = async (
          check: () => unknown | Promise<unknown>,
          label: string,
        ) => {
          for (let n = 0; n < 200; n++) {
            if (await check()) return;
            await pause();
          }
          throw new Error(`Timed out: ${label}`);
        };
        const api = window.fable!;
        const row = (id: string) =>
          [...document.querySelectorAll<HTMLElement>("[data-sidebar-id]")].find(
            (element) => element.dataset.sidebarId === id,
          )!;
        const button = (id: string) =>
          row(id)?.querySelector<HTMLButtonElement>("button")!;
        const state = () => api.request("vault.state", undefined);
        const projectOrder = () =>
          [
            ...document.querySelectorAll<HTMLElement>(
              '[data-sidebar-kind="project"]',
            ),
          ].map((element) => element.dataset.sidebarId);
        const key = (kind: string, parentId: string, directory = "") =>
          JSON.stringify([kind, parentId, directory]);
        await wait(() => row(ids.page), "renderer ready");
        const drag = async (
          source: string,
          target: string,
          edge: "before" | "after" | "inside",
          checkExpansion = false,
        ) => {
          const element = row(source),
            data = new DataTransfer();
          const send = (element: HTMLElement, type: string) => {
            const rect = element.getBoundingClientRect();
            element.dispatchEvent(
              new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: data,
                clientX: rect.left + rect.width / 2,
                clientY:
                  edge === "before"
                    ? rect.top + 3
                    : edge === "after"
                      ? rect.bottom - 3
                      : rect.top + rect.height / 2,
              }),
            );
          };
          send(element, "dragstart");
          await pause();
          send(row(target), "dragover");
          await wait(
            () => row(target)?.querySelector(`.drop-${edge}`),
            "drop indicator",
          );
          if (checkExpansion)
            await wait(
              () => button(target).getAttribute("aria-expanded") === "true",
              "hover expansion",
            );
          send(row(target), "drop");
          send(element, "dragend");
          await pause();
          await wait(
            () => !document.querySelector('[aria-busy="true"]'),
            "move complete",
          );
          const error = document.querySelector(
            ".sidebar-drag-error",
          )?.textContent;
          if (error) throw new Error(error);
        };
        await drag(ids.second, ids.first, "before");
        await wait(() => projectOrder()[0] === ids.second, "project reorder");
        let settings = await api.request("views.read", undefined);
        if (
          settings.sidebarOrder?.[key("projects", ids.area)]?.[0] !== ids.second
        )
          throw new Error("Project order was not saved");
        await drag(`${ids.base}/Beta`, `${ids.base}/Alpha`, "before");
        settings = await api.request("views.read", undefined);
        if (
          settings.sidebarOrder?.[key("folders", ids.first, ids.base)]?.[0] !==
          `${ids.base}/Beta`
        )
          throw new Error("Folder order was not saved");
        await drag(ids.other, ids.page, "before");
        settings = await api.request("views.read", undefined);
        if (
          settings.sidebarOrder?.[key("pages", ids.first, ids.base)]?.[0] !==
          ids.other
        )
          throw new Error("Page order was not saved");
        button(`${ids.base}/Alpha`).click();
        await drag(ids.page, `${ids.base}/Alpha`, "inside", true);
        await wait(
          async () =>
            (await state())?.documents.find((doc) => doc.id === ids.page)
              ?.path === `${ids.base}/Alpha/Moving page.md`,
          "file moved into folder",
        );
        await drag(ids.page, ids.second, "inside", true);
        await wait(
          async () =>
            (await state())?.documents.find((doc) => doc.id === ids.page)
              ?.metadata.parent === ids.second,
          "new project association",
        );
        // The same handler supports keyboard reordering without changing folder expansion.
        button(ids.second).dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            altKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await wait(() => projectOrder()[0] === ids.first, "keyboard reorder");
        return {
          projectReorder: true,
          folderReorder: true,
          pageReorder: true,
          moveIntoFolder: true,
          moveAcrossProjects: true,
          hoverExpansion: true,
          keyboardReorder: true,
        };
      }} )(${JSON.stringify({ area: area.id, first: first.id, second: second.id, page: page.id, other: other.id, base })})`,
    );
    await renderer.executeJavaScript(`(async () => {
      document.querySelector('[data-sidebar-id="${page.id}"] button').click();
      for (let n = 0; n < 200 && !document.querySelector('.cm-content'); n++) await new Promise(resolve => setTimeout(resolve, 20));
      const content = document.querySelector('.cm-content');
      if (!content) throw new Error('Page editor did not open');
      content.focus();
    })()`);
    await renderer.insertText("Preserve this draft before moving. ");
    await renderer.executeJavaScript(`(async () => {
      const source = document.querySelector('[data-sidebar-id="${page.id}"]'), target = document.querySelector('[data-sidebar-id="${first.id}"]'), data = new DataTransfer();
      const send = (element, type) => { const rect = element.getBoundingClientRect(); element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + 20, clientY: rect.top + rect.height / 2 })); };
      send(source, 'dragstart');
      await new Promise(resolve => setTimeout(resolve, 30));
      send(target, 'dragover'); send(target, 'drop'); send(source, 'dragend');
      for (let n = 0; n < 200; n++) {
        const state = await window.fable.request('vault.state');
        const page = state.documents.find(doc => doc.id === '${page.id}');
        if (page.metadata.parent === '${first.id}' && page.raw.includes('Preserve this draft before moving.')) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('The current draft was not preserved during the move');
    })()`);
    result.unsavedDraftPreserved = true;
    const moved = service.vault.document(page.id);
    if (!(await fs.stat(path.join(service.vault.root, moved.path))).isFile())
      throw new Error("Moved file missing");
    console.log("FABLE_SIDEBAR_SMOKE PASS", JSON.stringify(result));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    nativeWindow?.destroy();
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
    app.exit(Number(process.exitCode ?? 0));
  }
});
