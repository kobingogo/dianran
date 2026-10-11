async (page) => {
    const pages = page.context().pages();
    let a;
    for (const candidate of pages) if (await candidate.getByText("当前页面拥有编辑权", {exact:true}).count()) a = candidate;
    if (!a) throw new Error("no writer page");
    const b = pages.find(candidate => candidate !== a);
    const result = [];
    const mod = async (p, path) => p.evaluate(async (path) => {
        const url = performance.getEntriesByType("resource").find(x => new URL(x.name).pathname === path)?.name || path;
        return (await import(url)).writeOwnership?.getSnapshot();
    }, path);
    if (await mod(a, "/src/lib/write-ownership.ts") !== "writer" || await mod(b, "/src/lib/write-ownership.ts") !== "readonly") throw new Error("unexpected initial ownership");
    const checks = await b.evaluate(async () => {
        const load = async path => import(performance.getEntriesByType("resource").find(x => new URL(x.name).pathname === path)?.name || path);
        const { useCanvasStore } = await load("/src/stores/canvas/use-canvas-store.ts");
        const { cleanupUnusedMedia, uploadMediaFile } = await load("/src/services/file-storage.ts");
        const { requestGeneration } = await load("/src/services/api/image.ts");
        const { useComposerStore } = await load("/src/stores/use-composer-store.ts");
        const { useWorkflowStore } = await load("/src/stores/canvas/use-workflow-store.ts");
        const checks = [];
        for (const fn of [() => useCanvasStore.getState().createProject("forbidden"), () => cleanupUnusedMedia({}), () => uploadMediaFile(new Blob(["forbidden"])), () => requestGeneration({}, "forbidden"), () => useComposerStore.getState().patch("image", {prompt:"forbidden"}), () => useWorkflowStore.getState().remove("forbidden")]) {
            let rejected = false;
            try { await fn(); } catch (error) { if (!/编辑权|只读/.test(error.message)) throw error; rejected = true; }
            if (!rejected) throw new Error("readonly mutation was permitted");
            checks.push("rejected before mutation");
        }
        return checks;
    });
    result.push({readonlyEntryChecks: checks.length});
    result.push(await a.evaluate(async () => {
        const load = async path => import(performance.getEntriesByType("resource").find(x => new URL(x.name).pathname === path)?.name || path);
        const {writeOwnership} = await load("/src/lib/write-ownership.ts");
        const media = await load("/src/services/file-storage.ts");
        const upload = media.uploadMediaFile(new Blob(["T04 in-flight upload"], {type:"application/octet-stream"}));
        let blocked = false;
        try { await writeOwnership.relinquish(async () => {}); } catch (error) { blocked = /正在执行/.test(error.message); }
        if (!blocked) throw new Error("in-flight upload allowed handoff");
        const [file] = await Promise.all([upload, media.cleanupUnusedMedia({})]);
        if (await (await media.getMediaBlob(file.storageKey)).text() !== "T04 in-flight upload") throw new Error("cleanup deleted in-flight upload");
        return {uploadCleanupRacePreservedFile:true,uploadBlocksHandoff:true};
    }));
    await a.evaluate(async () => {
        const load = async path => import(performance.getEntriesByType("resource").find(x => new URL(x.name).pathname === path)?.name || path);
        const {useCanvasStore,flushCanvasSave} = await load("/src/stores/canvas/use-canvas-store.ts");
        const {useAssetStore} = await load("/src/stores/use-asset-store.ts");
        const {useAgentStore} = await load("/src/stores/use-agent-store.ts");
        useAgentStore.setState({activeThreadId:"T04-test-thread",prompt:"old Agent draft"});
        const {useComposerStore} = await load("/src/stores/use-composer-store.ts");
        useComposerStore.getState().saveAgentDraft(useAgentStore.getState().url + ":T04-test-thread", {prompt:"old Agent draft",attachments:[],canvasReferences:[]});
        if (!useCanvasStore.getState().projects.length) useCanvasStore.getState().createProject("初始项目");
        useCanvasStore.getState().renameProject(useCanvasStore.getState().projects[0].id, "最新权威项目");
        useCanvasStore.getState().createProject("另一项目");
        await flushCanvasSave();
        await useAssetStore.getState().addAsset({kind:"text",title:"新素材",coverUrl:"",tags:[],data:{content:"T04 独立测试"}});
    });
    await a.getByRole("button", {name:"保存并释放编辑权",exact:true}).click();
    await a.getByRole("heading", {name:"只读浏览",exact:true}).waitFor();
    await b.getByRole("button", {name:"在此页编辑",exact:true}).click();
    await b.getByText("当前页面拥有编辑权", {exact:true}).waitFor();
    const state = await b.evaluate(async () => {
        const load = async path => import(performance.getEntriesByType("resource").find(x => new URL(x.name).pathname === path)?.name || path);
        return {projects:(await load("/src/stores/canvas/use-canvas-store.ts")).useCanvasStore.getState().projects.map(x=>x.title),assets:(await load("/src/stores/use-asset-store.ts")).useAssetStore.getState().assets.map(x=>x.title)};
    });
    if (!state.projects.includes("最新权威项目") || !state.projects.includes("另一项目") || !state.assets.includes("新素材")) throw new Error("handoff retained stale data");
    result.push({freshStateAfterHandoff:state});
    await b.evaluate(async () => {
        const path="/src/stores/use-composer-store.ts";
        const {useComposerStore,flushComposerSave}=await import(performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname===path).name);
        const agentPath="/src/stores/use-agent-store.ts";
        const {useAgentStore}=await import(performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname===agentPath).name);
        useComposerStore.getState().saveAgentDraft(useAgentStore.getState().url + ":T04-test-thread", {prompt:"fresh Agent draft",attachments:[],canvasReferences:[]});
        await flushComposerSave();
    });
    await b.evaluate(async () => {
        window.t04OriginalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) { if(this.name === "app_state") throw new DOMException("T04 quota injection", "QuotaExceededError"); return window.t04OriginalPut.apply(this,args); };
        const url=performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname==="/src/stores/canvas/use-canvas-store.ts").name;
        const {useCanvasStore,flushCanvasSave} = await import(url);
        useCanvasStore.getState().renameProject(useCanvasStore.getState().projects[0].id,"保存失败仍保留的编辑");
        try { await flushCanvasSave(); } catch(e) { return e.name; }
        throw new Error("save unexpectedly succeeded");
    });
    await b.getByRole("button", {name:"保存并释放编辑权",exact:true}).click();
    await b.getByText(/保存失败，编辑权保留/).waitFor();
    await a.getByRole("button", {name:"在此页编辑",exact:true}).click();
    if(await mod(a,"/src/lib/write-ownership.ts") !== "readonly") throw new Error("save failure released lock");
    result.push({failedSaveRetainsWriter:true});
    await b.evaluate(async () => {
        IDBObjectStore.prototype.put=window.t04OriginalPut;
        const url=performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname==="/src/stores/canvas/use-canvas-store.ts").name;
        await (await import(url)).retryCanvasSave();
    });
    await b.getByRole("button", {name:"保存并释放编辑权",exact:true}).click();
    await b.getByRole("heading", {name:"只读浏览",exact:true}).waitFor();
    await a.getByRole("button", {name:"在此页编辑",exact:true}).click();
    await a.getByText("当前页面拥有编辑权", {exact:true}).waitFor();
    const restoredDraft=await a.evaluate(async()=>{
        const path="/src/stores/use-agent-store.ts";
        return (await import(performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname===path).name)).useAgentStore.getState().prompt;
    });
    if(restoredDraft!=="fresh Agent draft") throw new Error("Agent draft retained stale memory");
    result.push({agentDraftRereadAfterHandoff:true});
    await a.close();
    await b.getByRole("button", {name:"在此页编辑",exact:true}).click();
    await b.getByText("当前页面拥有编辑权", {exact:true}).waitFor();
    result.push({writerCloseReleasesLock:true});
    await b.reload();
    await b.getByText("当前页面拥有编辑权", {exact:true}).waitFor();
    result.push({writerRefreshReacquires:true});
    const unsupported = await page.context().newPage();
    await unsupported.addInitScript(() => Object.defineProperty(Navigator.prototype,"locks",{get:()=>undefined}));
    await unsupported.goto("http://localhost:3001/");
    await unsupported.getByText(/浏览器不支持安全的跨页面编辑锁/).waitFor();
    await unsupported.getByRole("heading",{name:"只读浏览",exact:true}).waitFor();
    if(await unsupported.getByRole("button",{name:"在此页编辑",exact:true}).count()) throw new Error("unsupported browser allows takeover");
    result.push({unsupportedBrowserReadonly:true});
    await unsupported.close();
    return result;
}
