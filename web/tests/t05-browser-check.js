async (page) => {
    await page.getByRole("button",{name:"测试连接",exact:true}).click();
    await page.getByText(/@kobinflow\/canvas-proxy v0.2.0/).waitFor();
    const verified=await page.evaluate(async()=>{
        const load=async path=>import(performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname===path)?.name||path);
        const {readProxyPairing}=await load("/src/stores/use-local-proxy-store.ts");
        const pairing=readProxyPairing(),target=pairing.targets[0];
        const {withLocalProxy}=await load("/src/stores/use-config-store.ts");
        const {proxyFetch}=await load("/src/services/api/proxy-transport.ts");
        const models=await(await load("/src/services/api/image.ts")).fetchImageModels({baseUrl:target,apiKey:"test-provider-key",apiFormat:"openai"});
        if(!models.includes("test-local-model"))throw new Error("actual model-list request failed");
        const axiosUrl=performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname.endsWith("/axios.js")).name;
        const axios=(await import(axiosUrl)).default;
        const response=await axios.post(withLocalProxy(target+"/echo"),{test:"body preserved"},{headers:{Authorization:"Bearer test-provider-key"}});
        if(response.data.pairingLeaked||response.data.authorization!=="Bearer test-provider-key")throw new Error("credential boundary failed");
        const stream=await proxyFetch(withLocalProxy(target+"/stream"));
        if(await stream.text()!=="data: first\n\ndata: last\n\n")throw new Error("SSE stream damaged");
        const webdav=await load("/src/services/webdav-sync.ts");
        const file=await webdav.downloadWebdavFile({url:target,username:"user",password:"test-password",directory:"",lastSyncedAt:""},"download");
        const dav=JSON.parse(await file.text());
        if(dav.pairingLeaked||!dav.authorization.startsWith("Basic "))throw new Error("WebDAV credential boundary failed");
        let denied=false;try{withLocalProxy("https://not-authorized.test/v1/models");}catch(e){denied=e.message.includes("未授权");}if(!denied)throw new Error("unapproved target allowed");
        let redirectDenied=false;try{await proxyFetch(withLocalProxy(target+"/redirect"));}catch(e){redirectDenied=e.message.includes("重定向");}if(!redirectDenied)throw new Error("redirect escaped policy");
        return {modelList:true,axiosPost:true,sse:true,webdav:true,noPairingLeak:true,unapprovedTargetDenied:true,redirectDenied:true};
    });
    const credentials=await page.evaluate(async()=>{
        const path="/src/stores/use-local-proxy-store.ts";
        return (await import(performance.getEntriesByType("resource").find(x=>new URL(x.name).pathname===path).name)).readProxyPairing();
    });
    const downloadPromise=page.waitForEvent("download");
    await page.getByRole("button",{name:"导出配置",exact:true}).click();
    const download=await downloadPromise;
    const stream=await download.createReadStream();let content="";for await(const chunk of stream)content+=chunk.toString();
    if(content.includes(credentials.token)||content.includes("local_proxy_pairing"))throw new Error("shared config leaked pairing");
    await page.route(credentials.proxyUrl+"/**",route=>route.abort("blockedbyclient"));
    await page.getByRole("button",{name:"测试连接",exact:true}).click();
    await page.getByText(/本地网络访问/).waitFor();
    await page.unroute(credentials.proxyUrl+"/**");
    await page.getByRole("button",{name:"测试连接",exact:true}).click();
    await page.getByText(/@kobinflow\/canvas-proxy v0.2.0/).waitFor();
    return {...verified,configExportExcludesPairing:true,networkDenialHasRecoveryGuidance:true};
}
