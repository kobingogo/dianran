async (page) => {
    const base = "http://127.0.0.1:4317", prompt = "一只蓝色陶瓷杯，柔和侧光", author = "Iteration Author", external = [];
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1cAAAAASUVORK5CYII=", "base64");
    page.on("dialog", dialog => { if (dialog.type() === "beforeunload") void dialog.accept().catch(() => {}); });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== base && ["http:", "https:"].includes(url.protocol)) { external.push({ method: route.request().method(), path: url.pathname }); return route.abort("blockedbyclient"); }
        if (url.pathname.startsWith("/prompt-sources/")) {
            if (url.pathname.endsWith(".png")) return route.fulfill({ contentType: "image/png", body: image });
            if (url.pathname.endsWith("manifest.json")) return route.fulfill({ json: { generatedAt: "iteration-fixture" } });
            const target = url.pathname.endsWith("dianran-picks.json");
            return route.fulfill({ json: [{ id: url.pathname, title: target ? "迭代提示词样例" : `其他样例 ${url.pathname}`, prompt: target ? prompt : "其他内容", author: target ? author : "Other Author", model: target ? "Iteration Model" : "Other Model", tags: [target ? "产品摄影" : "其他"], coverUrl: "/prompt-sources/covers/iteration.png", referenceImageUrls: [], createdAt: "2026-01-01" }] });
        }
        return route.continue();
    });
    const ready = async () => {
        await page.evaluate(async () => {
            window.__iterationLoad = path => import(performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === path)?.name || path);
            window.__iterationWriter = (await window.__iterationLoad("/src/lib/write-ownership.ts")).writeOwnership;
            window.__iterationComposer = (await window.__iterationLoad("/src/stores/use-composer-store.ts")).useComposerStore;
        });
        await page.waitForFunction(() => window.__iterationWriter.canWrite() && window.__iterationComposer.getState().hydrated);
    };
    const choose = async (mode) => {
        await page.getByRole("button", { name: "去创作", exact: true }).click();
        await page.getByRole("menuitem", { name: mode, exact: true }).click();
    };
    await page.goto(base + "/prompts"); await ready();
    await page.waitForFunction(() => document.querySelectorAll("h2").length === 6);
    const search = page.getByRole("textbox", { name: "搜索提示词、作者或标签", exact: true });
    await search.fill(author);
    await page.getByRole("heading", { name: "迭代提示词样例", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll("h2").length === 1);
    await page.evaluate(async () => {
        window.__iterationComposer.getState().patch("image", { prompt: "必须保留的原草稿", references: [] });
        await (await window.__iterationLoad("/src/stores/use-composer-store.ts")).flushComposerSave();
    });
    await choose("生图工作台");
    const confirmation = page.getByRole("dialog", { name: "替换当前草稿？", exact: true });
    await confirmation.getByRole("button", { name: "保留草稿", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    if (new URL(page.url()).pathname !== "/prompts" || await page.evaluate(() => window.__iterationComposer.getState().image.prompt) !== "必须保留的原草稿") throw Error("Cancel replaced the draft or navigated away");
    await choose("生图工作台");
    await confirmation.getByRole("button", { name: "替换草稿", exact: true }).click();
    await page.waitForURL(base + "/image");
    await page.getByRole("textbox", { name: "提示词", exact: true }).waitFor();
    await ready();
    if (await page.getByRole("textbox", { name: "提示词", exact: true }).inputValue() !== prompt || await page.evaluate(() => window.__iterationComposer.getState().image.references.length)) throw Error("Prompt handoff changed text or imported sample references");
    await page.reload(); await ready();
    await page.getByRole("textbox", { name: "提示词", exact: true }).waitFor();
    if (await page.getByRole("textbox", { name: "提示词", exact: true }).inputValue() !== prompt) throw Error("Prompt handoff did not survive reload");
    await page.goto(base + "/prompts"); await ready();
    await page.waitForFunction(() => document.querySelectorAll("h2").length === 6);
    await page.getByRole("textbox", { name: "搜索提示词、作者或标签", exact: true }).fill("Iteration Model");
    await page.waitForFunction(() => document.querySelectorAll("h2").length === 1);
    await page.getByRole("heading", { name: "迭代提示词样例", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "迭代提示词样例", exact: true });
    await detail.getByRole("button", { name: "用此提示词", exact: true }).click();
    await page.getByRole("menuitem", { name: "视频工作台", exact: true }).click();
    await page.waitForURL(base + "/video");
    await page.getByRole("textbox", { name: "提示词", exact: true }).waitFor();
    await ready();
    if (await page.getByRole("textbox", { name: "提示词", exact: true }).inputValue() !== prompt) throw Error("Detail did not open the video draft");
    const fixture = await page.evaluate(async () => {
        const { useCanvasStore, flushCanvasSave } = await window.__iterationLoad("/src/stores/canvas/use-canvas-store.ts");
        const { uploadImage } = await window.__iterationLoad("/src/services/image-storage.ts");
        if (!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
        const images = [];
        for (const [id, width, height, color] of [["iteration-a", 120, 180, "#468"], ["iteration-b", 160, 90, "#e87"]]) {
            const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
            canvas.getContext("2d").fillStyle = color; canvas.getContext("2d").fillRect(0, 0, width, height);
            const stored = await uploadImage(await new Promise(resolve => canvas.toBlob(resolve, "image/png")));
            images.push({ id, status: "success", content: stored.url, storageKey: stored.storageKey, naturalWidth: width, naturalHeight: height, bytes: stored.bytes, mimeType: stored.mimeType });
        }
        images.push({ id: "iteration-missing", status: "success", content: "", storageKey: "image:iteration-missing", naturalWidth: 160, naturalHeight: 90, bytes: 0, mimeType: "image/png" });
        const node = { id: "iteration-batch", type: "image", title: "迭代候选", position: { x: 100, y: 160 }, width: 240, height: 360, metadata: { ...images[0], images, primaryImageId: images[0].id, prompt: "保留陶瓷杯构图，调整侧光" } };
        const id = useCanvasStore.getState().importProject({ title: "迭代比较自动验收", nodes: [node], connections: [], viewport: { x: 0, y: 0, k: 1 }, chatSessions: [], activeChatId: null });
        await flushCanvasSave(); return { id, selectedKey: images[1].storageKey };
    });
    await page.goto(base + "/canvas/" + fixture.id); await ready();
    const openComparison = async () => {
        await page.locator('[data-node-id="iteration-batch"]').click({ position: { x: 24, y: 16 } });
        await page.getByRole("button", { name: "比较所选结果", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "批次与版本比较", exact: true });
        await dialog.locator("article").nth(2).waitFor();
        await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"] article img')).filter(img => img.complete && img.naturalWidth > 0).length === 2);
        return dialog;
    };
    let comparison = await openComparison();
    if (!await comparison.locator("article").nth(2).getByRole("button", { name: "采用为主图", exact: true }).isDisabled() || !await comparison.locator("article").nth(2).getByRole("button", { name: "用作参考继续创作", exact: true }).isDisabled()) throw Error("Missing image actions were enabled");
    if (await comparison.locator("details[open]").count()) throw Error("Parameters should be collapsed initially");
    await comparison.locator("article").nth(1).getByRole("button", { name: "采用为主图", exact: true }).click();
    await comparison.locator("article").nth(1).getByRole("heading", { name: "迭代候选 · 2 · 主图", exact: true }).waitFor();
    await page.evaluate(async () => { await (await window.__iterationLoad("/src/stores/canvas/use-canvas-store.ts")).flushCanvasSave(); });
    await page.screenshot({ path: "output/playwright/evidence/creation-iteration-comparison.png" });
    await page.reload(); await ready();
    await page.locator('[data-node-id="iteration-batch"]').waitFor();
    const saved = await page.evaluate(async id => {
        const store = (await window.__iterationLoad("/src/stores/canvas/use-canvas-store.ts")).useCanvasStore;
        if (!store.getState().hydrated) throw Error("Canvas not hydrated");
        return store.getState().openProject(id).nodes[0];
    }, fixture.id);
    if (saved.metadata.primaryImageId !== "iteration-b" || saved.metadata.images.length !== 3 || Math.abs(saved.width / saved.height - 160 / 90) > 0.001) throw Error("Adoption lost persistence, candidates or aspect ratio");
    comparison = await openComparison();
    await comparison.locator("article").nth(1).getByRole("button", { name: "用作参考继续创作", exact: true }).click();
    await confirmation.getByRole("button", { name: "替换草稿", exact: true }).click();
    await page.waitForURL(base + "/image");
    await page.getByRole("textbox", { name: "提示词", exact: true }).waitFor();
    await ready();
    const continued = await page.evaluate(() => window.__iterationComposer.getState().image);
    if (continued.prompt !== "保留陶瓷杯构图，调整侧光" || continued.references.length !== 1 || continued.references[0].storageKey !== fixture.selectedKey || continued.canvas) throw Error("Continuation did not load the selected result into the workbench draft");
    await page.reload(); await ready();
    if (await page.evaluate(() => window.__iterationComposer.getState().image.references[0]?.storageKey) !== fixture.selectedKey) throw Error("Reference handoff did not survive reload");
    await page.screenshot({ path: "output/playwright/evidence/creation-iteration-workbench.png" });
    if (external.some(request => request.method !== "GET")) throw Error("Draft preparation unexpectedly submitted an external request");
    return { promptLibrary: { authorSearch: true, modelSearch: true, cancelPreservesDraft: true, imageCard: true, videoDetail: true, reload: true }, comparison: { adopt: true, aspectRatio: "160:90", candidatesRetained: 3, missingImageDisabled: true, parametersCollapsed: true, continuation: true, reload: true }, externalSubmissions: 0 };
}
