async (page) => {
    const base = "http://127.0.0.1:4317", gateway = "https://dianran-model-gateway.yangling7212.workers.dev", calls = [];
    await page.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === gateway) {
            if (request.method() !== "GET" || url.pathname !== "/api/model-gateway/whatstoken/v1/models" || url.search) throw Error("Unexpected gateway request");
            const headers = request.headers();
            if (headers.authorization !== "Bearer fixture-only-token" || headers["x-dianran-proxy-token"] || headers.cookie) throw Error("Wrong gateway credential handling");
            calls.push("cloud-models");
            return route.fulfill({ json: { data: ["gpt-image-2-official", "wan3.0-video", "flux-image-new"].map(id => ({ id })) } });
        }
        if (url.origin === "https://www.whatstoken.ai" || url.origin === "http://127.0.0.1:23210") throw Error("Cloud configuration attempted a direct or local-proxy request");
        if (url.origin !== base && ["http:", "https:"].includes(url.protocol)) return route.abort("blockedbyclient");
        return route.continue();
    });
    await page.goto(base + "/image?provider=whatstoken");
    await page.getByText("此渠道通过点染云端网关连接，无需启动本机代理。Token 保存在当前浏览器，每次请求经网关转发给 whatsToken；网关不保存 Token 或生成内容。", { exact: true }).waitFor();
    await page.getByPlaceholder("sk-...", { exact: true }).fill("fixture-only-token");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "保存并完成", exact: true }).click();
    await page.locator("[data-onboarding-done]").waitFor();
    await page.getByRole("button", { name: "去生图", exact: true }).click();
    await page.getByRole("button", { name: "选择模型", exact: true }).filter({ hasText: "gpt-image-2-official" }).click();
    await page.getByRole("option", { name: "flux-image-new（WhatsToken）", exact: true }).waitFor();
    if (calls.join(",") !== "cloud-models") throw Error("Unexpected additional API calls");
    return { cloudPrivacyBeforeToken: true, modelListViaCloud: true, localProxyRequests: 0, generationRequests: 0, selectableModels: true };
}
