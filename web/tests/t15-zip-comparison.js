async (page) => page.evaluate(async () => {
    if(location.origin!=='http://localhost:3002')throw Error('Use independent benchmark origin');
    const load=async path=>import(performance.getEntriesByType('resource').find(x=>new URL(x.name).pathname===path)?.name||path);
    const {useCanvasStore}=await load('/src/stores/canvas/use-canvas-store.ts');
    const {prepareCanvasArchive,readCanvasArchive}=await load('/src/lib/canvas/canvas-archive.ts');
    const {createZip}=await load('/src/lib/zip.ts');
    const fflateResource=performance.getEntriesByType('resource').find(x=>new URL(x.name).pathname.endsWith('/fflate.js'));
    const {zipSync}=await import(fflateResource.name);
    const project=useCanvasStore.getState().projects.find(x=>x.title==='T15 模拟 200 节点');
    const archive=await prepareCanvasArchive([project]);
    const files=[{name:'projects.json',data:JSON.stringify(archive.manifest)},...archive.files];
    const legacy=async()=>{
        const entries=await Promise.all(files.map(async file=>[file.name,new Uint8Array(await new Blob([file.data]).arrayBuffer())]));
        return new Blob([zipSync(Object.fromEntries(entries),{level:0})],{type:'application/zip'});
    };
    const rounds=[];
    for(const label of ['legacy','worker','legacy','worker']){
        const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));
        observer.observe({type:'longtask'});
        const start=performance.now(),zip=await(label==='legacy'?legacy():createZip(files)),elapsed=performance.now()-start;
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);observer.disconnect();
        const restored=await readCanvasArchive(zip);
        if(restored.manifest.projects[0].files.length!==archive.manifest.projects[0].files.length)throw Error('Archive files changed');
        rounds.push({label,elapsedMs:elapsed,mainThreadLongTasksMs:tasks,zipBytes:zip.size,validatedFiles:restored.manifest.projects[0].files.length});
    }
    return {nodes:project.nodes.length,mediaBytes:archive.manifest.projects[0].files.reduce((sum,file)=>sum+file.bytes,0),rounds,note:'Same page, same snapshot and files; legacy algorithm comparison fixture only; no runtime fallback'};
})
