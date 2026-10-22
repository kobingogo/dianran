async (page) => {
    const base = "http://127.0.0.1:4317", requests = [];
    const names = ["gpt-image-2-official", "wan3.0-video", "flux-image-new", "wan3.0-video-prime"];
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === "https://www.whatstoken.ai") {
            requests.push({ method: request.method(), path: url.pathname });
            if (request.method() !== "GET" || url.pathname !== "/v1/models" || url.search) throw Error("Unexpected provider request");
            if (request.headers().authorization !== "Bearer fixture-only-token") throw Error("Missing model-list authentication");
            return route.fulfill({ json: { data: names.map(id => ({ id })) } });
        }
        if (url.origin !== base && ["http:", "https:"].includes(url.protocol)) return route.abort("blockedbyclient");
        return route.continue();
    });
    await page.goto(base + "/image?provider=whatstoken");
    const key = page.locator('input[type="password"]');
    await key.waitFor();
    if (await key.inputValue() || new URL(page.url()).searchParams.has("provider")) throw Error("Token input must start blank; provider link should be consumed");
    if (requests.length) throw Error("Opening Token dialog must not call provider");
    await key.fill("fixture-only-token");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "保存并完成", exact: true }).waitFor();
    await page.getByRole("button", { name: "保存并完成", exact: true }).click();
    await page.locator("[data-onboarding-done]").waitFor();
    await page.getByRole("button", { name: "去生图", exact: true }).click();
    await page.getByRole("textbox", { name: "提示词", exact: true }).waitFor();
    const read = async () => page.evaluate(async () => {
        const path = "/src/stores/use-config-store.ts";
        const url = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === path)?.name;
        const { useConfigStore } = await import(url);
        return { names: useConfigStore.getState().config.channels.flatMap(channel => channel.models.map(model => model.name)), image: useConfigStore.getState().config.imageModel, video: useConfigStore.getState().config.videoModel };
    });
    let config = await read();
    if (!config.image.endsWith("::gpt-image-2-official") || !config.video.endsWith("::wan3.0-video") || names.some(name => !config.names.includes(name))) throw Error("Default recommendations restricted available models");
    const modelButton = page.getByRole("button", { name: "选择模型", exact: true });
    await modelButton.filter({ hasText: "gpt-image-2-official" }).click();
    await page.getByRole("option", { name: "flux-image-new（WhatsToken）", exact: true }).click();
    if (!(await read()).image.endsWith("::flux-image-new")) throw Error("Image model selection failed");
    await page.goto(base + "/video");
    await page.getByRole("textbox", { name: "提示词", exact: true }).waitFor();
    await modelButton.filter({ hasText: "wan3.0-video" }).click();
    await page.getByRole("option", { name: "wan3.0-video-prime（WhatsToken）", exact: true }).click();
    await modelButton.filter({ hasText: "wan3.0-video-prime" }).waitFor();
    await page.reload();
    await modelButton.filter({ hasText: "wan3.0-video-prime" }).waitFor();
    config = await read();
    if (!config.image.endsWith("::flux-image-new") || !config.video.endsWith("::wan3.0-video-prime")) throw Error("Selected models did not survive reload");
    if (requests.length !== 1) throw Error("Configuration or model switching sent a generation request");
    return { passed: true, modelListReads: requests.length, generationRequests: 0, selectableImageModels: 2, selectableVideoModels: 2, selectionSurvivesReload: true };
}
