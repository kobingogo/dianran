async (page) => {
    const base = "http://127.0.0.1:4317", target = "https://www.whatstoken.ai/v1", proxy = "http://127.0.0.1:23210", calls = [];
    await page.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === "https://www.whatstoken.ai") { calls.push("direct-model-list-blocked"); return route.abort("blockedbyclient"); }
        if (url.origin === proxy) {
            if (request.headers()["x-dianran-proxy-token"] !== "fixture-proxy-token") throw Error("Missing scoped proxy credential");
            if (url.pathname === "/") { calls.push("pairing-probe"); return route.fulfill({ json: { proxy: "@kobinflow/canvas-proxy", protocol: 2, version: "0.2.0", targets: [target] } }); }
            if (url.pathname !== "/" + target + "/models" || request.method() !== "GET" || request.headers().authorization !== "Bearer fixture-only-token") throw Error("Unexpected proxy request");
            calls.push("proxied-model-list");
            return route.fulfill({ json: { data: [{ id: "gpt-image-2-official" }, { id: "wan3.0-video" }] } });
        }
        if (url.origin !== base && ["http:", "https:"].includes(url.protocol)) return route.abort("blockedbyclient");
        return route.continue();
    });
    await page.goto(base + "/image?provider=whatstoken");
    await page.getByPlaceholder("sk-...", { exact: true }).fill("fixture-only-token");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    const error = page.locator('[data-onboarding-error="network"]');
    await error.waitFor();
    const command = await error.locator(".font-mono span").innerText();
    if (!command.includes("node canvas-proxy/index.js") || !command.includes("--origin '" + base + "'") || !command.includes("--target '" + target + "'") || command.includes("fixture-only-token") || command.includes("@latest")) throw Error("Pairing command is incomplete or contains a credential");
    const upload = error.locator('input[type="file"]');
    const file = origins => ({ name: "fixture-pairing.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ protocol: 2, proxyUrl: proxy, token: "fixture-proxy-token", origins, targets: [target] })) });
    await upload.setInputFiles(file(["https://other.example"]));
    await page.getByText("配对文件未授权当前网页来源，请在启动命令中添加当前站点的 --origin", { exact: true }).waitFor();
    if (calls.length !== 1) throw Error("Invalid origin caused a probe or model request");
    await upload.setInputFiles(file([base]));
    await page.getByText("本地代理已配对，请点击重试读取模型", { exact: true }).waitFor();
    await error.getByRole("button", { name: "重试", exact: true }).click();
    const save = page.getByRole("button", { name: "保存并完成", exact: true });
    await save.waitFor();
    await save.click();
    await page.locator("[data-onboarding-done]").waitFor();
    if (calls.join(",") !== "direct-model-list-blocked,pairing-probe,proxied-model-list") throw Error("Unexpected retry or generation request");
    return { directCorsFailure: true, scopedCommand: true, wrongOriginRejected: true, pairingImportedInWizard: true, originalTokenRetained: true, proxiedModelListReads: 1, generationRequests: 0 };
}
