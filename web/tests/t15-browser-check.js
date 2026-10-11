async (page) => {
    const origin = "http://localhost:3002";
    if (new URL(page.url()).origin !== origin) throw new Error("This synthetic benchmark only runs in the independent localhost:3002 session");
    page.on("dialog", (dialog) => dialog.accept());
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByText("当前页面拥有编辑权", { exact: true }).waitFor();
    const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, logicalCpus: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, mode: "Vite development server, no throttling, seeded synthetic PNGs, no AI calls" }));
    await page.goto(origin + "/canvas");
    await page.getByText("当前页面拥有编辑权", { exact: true }).waitFor();
    await page.evaluate(async () => {
        const load = async (path) => import(performance.getEntriesByType("resource").find((item) => new URL(item.name).pathname === path)?.name || path);
        const { useCanvasStore, flushCanvasSave } = await load("/src/stores/canvas/use-canvas-store.ts");
        const state = useCanvasStore.getState();
        state.replaceProjects(state.projects.filter((project) => !project.title.startsWith("T15 模拟 ")), state.deletedProjects);
        await flushCanvasSave();
        await (await load("/src/services/image-storage.ts")).cleanupUnusedImages({});
    });
    const scenarios = [];
    for (const [count, side] of [[40, 256], [200, 512]]) {
        await page.goto(origin + "/canvas");
        await page.getByText("当前页面拥有编辑权", { exact: true }).waitFor();
        const fixture = await page.evaluate(async ({ count, side }) => {
            const load = async (path) => import(performance.getEntriesByType("resource").find((item) => new URL(item.name).pathname === path)?.name || path);
            const { useCanvasStore, flushCanvasSave } = await load("/src/stores/canvas/use-canvas-store.ts");
            const { setImageBlob } = await load("/src/services/image-storage.ts");
            const nodes = [], connections = [], files = [];
            for (let i = 0; i < count; i++) {
                const image = i % 3 === 0;
                const metadata = { status: "success", content: `模拟性能节点 ${i}：这是开发测试内容，不是用户项目。` };
                if (image) {
                    const canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
                    const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(side, side); let seed = i + 12345;
                    for (let p = 0; p < pixels.data.length; p += 4) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[p] = seed & 255; pixels.data[p + 1] = seed >>> 8 & 255; pixels.data[p + 2] = seed >>> 16 & 255; pixels.data[p + 3] = 255; }
                    ctx.putImageData(pixels, 0, 0);
                    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
                    const key = `image:t15-${count}-${i}`; await setImageBlob(key, blob);
                    files.push({ key, bytes: blob.size });
                    Object.assign(metadata, { storageKey: key, content: "", mimeType: "image/png", bytes: blob.size, naturalWidth: side, naturalHeight: side });
                }
                nodes.push({ id: `t15-node-${i}`, type: image ? "image" : "text", title: `T15 ${image ? "图片" : "文本"} ${i}`, position: { x: (i % 10) * 310 + 30, y: Math.floor(i / 10) * 220 + 40 }, width: 260, height: 180, metadata });
                if (i > 0) connections.push({ id: `t15-edge-${i}`, fromNodeId: nodes[i - 1].id, toNodeId: nodes[i].id, kind: "input" });
            }
            const id = useCanvasStore.getState().importProject({ title: `T15 模拟 ${count} 节点`, nodes, connections, chatSessions: [], activeChatId: null, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots", showImageInfo: false });
            await flushCanvasSave();
            return { id, nodes: count, connections: connections.length, imageFiles: files.length, imageSidePx: side, totalImageBytes: files.reduce((sum, file) => sum + file.bytes, 0), minFileBytes: Math.min(...files.map((file) => file.bytes)), maxFileBytes: Math.max(...files.map((file) => file.bytes)), projectJsonBytes: new Blob([JSON.stringify(useCanvasStore.getState().projects.find((project) => project.id === id))]).size };
        }, { count, side });
        const started = Date.now();
        await page.goto(`${origin}/canvas/${fixture.id}`, { waitUntil: "domcontentloaded" });
        await page.locator('[data-node-id="t15-node-1"]').waitFor({ state: "visible" });
        await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
        const loading = await page.evaluate(() => ({ navigationToCanvasReadyMs: performance.now(), domContentLoadedMs: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd, mountedNodes: document.querySelectorAll("[data-node-id]").length, resourceRequests: performance.getEntriesByType("resource").length, estimatedJsHeapBytes: performance.memory?.usedJSHeapSize }));
        loading.automationWallMs = Date.now() - started;
        const box = await page.locator('[data-node-id="t15-node-1"]').boundingBox();
        await page.evaluate(() => { window.t15Frames = []; window.t15MeasureFrames = true; let last; const tick = (now) => { if (last !== undefined) window.t15Frames.push(now - last); last = now; if (window.t15MeasureFrames) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        await page.mouse.move(box.x + 35, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 185, box.y + 95, { steps: 30 });
        await page.mouse.up();
        const dragging = await page.evaluate(async () => {
            window.t15MeasureFrames = false;
            const load = async (path) => import(performance.getEntriesByType("resource").find((item) => new URL(item.name).pathname === path)?.name || path);
            const { useCanvasStore } = await load("/src/stores/canvas/use-canvas-store.ts");
            const frames = window.t15Frames.slice().sort((a, b) => a - b);
            return { frames: frames.length, medianFrameMs: frames[Math.floor(frames.length / 2)], p95FrameMs: frames[Math.floor(frames.length * 0.95)], longestFrameMs: frames.at(-1), nodeAfterDrag: useCanvasStore.getState().projects[0].nodes.find((node) => node.id === "t15-node-1").position };
        });
        // Separate the first immediate interaction from the decoded-image steady state.
        await page.evaluate(async () => { await Promise.allSettled([...document.images].map((image) => image.decode())); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
        const warmBox = await page.locator('[data-node-id="t15-node-1"]').boundingBox();
        await page.evaluate(() => { window.t15Frames = []; window.t15MeasureFrames = true; let last; const tick = (now) => { if (last !== undefined) window.t15Frames.push(now - last); last = now; if (window.t15MeasureFrames) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        await page.mouse.move(warmBox.x + 35, warmBox.y + 20); await page.mouse.down();
        await page.mouse.move(warmBox.x - 115, warmBox.y - 55, { steps: 30 }); await page.mouse.up();
        const steadyDragging = await page.evaluate(() => { window.t15MeasureFrames = false; const frames = window.t15Frames.slice().sort((a, b) => a - b); return { frames: frames.length, medianFrameMs: frames[Math.floor(frames.length / 2)], p95FrameMs: frames[Math.floor(frames.length * 0.95)], longestFrameMs: frames.at(-1) }; });
        const operations = await page.evaluate(async (id) => {
            const load = async (path) => import(performance.getEntriesByType("resource").find((item) => new URL(item.name).pathname === path)?.name || path);
            const { useCanvasStore, flushCanvasSave } = await load("/src/stores/canvas/use-canvas-store.ts");
            const { writeOwnership } = await load("/src/lib/write-ownership.ts");
            const { collectStoredMediaReferences } = await load("/src/services/media-references.ts");
            const { cleanupUnusedImages } = await load("/src/services/image-storage.ts");
            const { canvasIndexedStorage } = await load("/src/lib/localforage-storage.ts");
            const { storageKey } = await load("/src/constant/brand.ts");
            const saving = performance.now(); writeOwnership.checkpoint(); await flushCanvasSave();
            const savedMs = performance.now() - saving;
            const persisted = JSON.parse(await canvasIndexedStorage.getItem(storageKey("canvas_store")));
            if (!persisted.state.projects.some((project) => project.id === id)) throw new Error("Missing actual IndexedDB save receipt");
            const scanning = performance.now(), keys = await collectStoredMediaReferences({});
            const scanMs = performance.now() - scanning;
            const fullScanning = performance.now(); await cleanupUnusedImages({}); const fullScanMs = performance.now() - fullScanning;
            const { prepareCanvasArchive } = await load("/src/lib/canvas/canvas-archive.ts"), { createZip } = await load("/src/lib/zip.ts");
            const project = useCanvasStore.getState().projects.find((project) => project.id === id);
            const longTasks = []; const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))); observer.observe({ type: "longtask", buffered: false });
            const exporting = performance.now(), prepared = await prepareCanvasArchive([project]);
            const prepareArchiveMs = performance.now() - exporting;
            if (prepared.manifest.backup.mode !== "complete" || prepared.manifest.backup.unavailableFiles.length || prepared.manifest.backup.externalLinks.length) throw new Error("Not a complete archive");
            const zipping = performance.now(); const zip = await createZip([{ name: "projects.json", data: JSON.stringify(prepared.manifest, null, 2) }, ...prepared.files]);
            const zipAssemblyMs = performance.now() - zipping, completeZipExportMs = performance.now() - exporting; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); observer.disconnect();
            return { saveFlushMs: savedMs, indexedDbSaveVerified: true, storageReferenceScanMs: scanMs, fullImageStoreScanMs: fullScanMs, scanKeysAcrossAllSeededProjects: keys.size, completeZipExportMs, prepareArchiveMs, zipAssemblyMs, exportLongTasks: longTasks, zipBytes: zip.size, zipFiles: prepared.files.length, estimatedJsHeapBytes: performance.memory?.usedJSHeapSize };
        }, fixture.id);
        scenarios.push({ fixture, loading, dragging, steadyDragging, operations });
    }
    return { environment, scenarios, pageErrors: errors, note: "Synthetic scenarios only; document/module HTTP cache warmed by seeding. No production build or real user project claims." };
}
