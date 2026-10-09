async (page) => {
    if(new URL(page.url()).origin!=='http://localhost:3001')throw Error('Use isolated localhost:3001');
    page.on('dialog',dialog=>dialog.accept());
    await page.setViewportSize({width:1440,height:1100});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const fixture=await page.evaluate(async()=>{
        const {useCanvasStore,flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');
        const {uploadImage}=await import('/src/services/image-storage.ts');
        const images=[];
        for(const [id,color] of [['candidate-a','#478'],['candidate-b','#e87']]){
            const canvas=document.createElement('canvas');canvas.width=120;canvas.height=180;canvas.getContext('2d').fillStyle=color;canvas.getContext('2d').fillRect(0,0,120,180);
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),image=await uploadImage(blob);
            images.push({id,status:'success',content:image.url,storageKey:image.storageKey,naturalWidth:image.width,naturalHeight:image.height,bytes:image.bytes,mimeType:image.mimeType});
        }
        images.push({id:'candidate-failed',status:'error',content:'',naturalWidth:0,naturalHeight:0,bytes:0,mimeType:'',errorDetails:'结果未知：模拟未收到响应'});
        const node={id:'t13-batch',type:'image',title:'T13 模拟候选',position:{x:20,y:20},width:300,height:450,metadata:{status:'success',...images[0],images,primaryImageId:'candidate-a',model:'mock::gpt-image-1',size:'1024x1536',prompt:'模拟产品视觉'}};
        const id=useCanvasStore.getState().importProject({title:'T13 隔离比较检查',nodes:[node],connections:[],viewport:{x:0,y:0,k:1},chatSessions:[],activeChatId:null});await flushCanvasSave();return{id};
    });
    await page.goto('http://localhost:3001/canvas/'+fixture.id);
    await page.getByRole('button',{name:'比较并采用',exact:true}).click();
    const compare=page.getByRole('dialog',{name:'比较候选并采用主图'});
    await compare.getByRole('button',{name:'采用为主图',exact:true}).last().click();
    const primary=await page.evaluate(async()=>{
        const {useCanvasStore,flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();
        return useCanvasStore.getState().projects.find(x=>x.id===location.pathname.split('/').at(-1)).nodes[0].metadata.primaryImageId;
    });
    if(primary!=='candidate-b')throw Error('Adoption did not update the original batch');
    await compare.getByRole('button',{name:'Close',exact:true}).click();
    await page.route('**/t06-cancel-plugin.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'globalThis.__t06Executed=true; export default {id:"t06-fixture",nodes:[{type:"t06-fixture:node"}]}'}));
    await page.getByRole('button',{name:'更多',exact:true}).click();
    await page.getByRole('menuitem',{name:/插件/}).click();
    const manager=page.getByRole('dialog').filter({has:page.getByRole('tab',{name:/第三方/})});
    await manager.getByRole('tab',{name:/第三方/}).click();
    await manager.getByRole('textbox').fill('http://localhost:3001/t06-cancel-plugin.js');
    await manager.getByRole('button',{name:'安装',exact:true}).click();
    const authorization=page.getByRole('dialog',{name:'授权安装并执行插件'});
    await authorization.getByText(/SHA-256/).waitFor();
    await authorization.getByRole('button',{name:/取\s*消/}).click();
    const noExecution=await page.evaluate(()=>globalThis.__t06Executed!==true);
    if(!noExecution)throw Error('Cancelled plugin executed');
    return {compareAdopted:primary,pluginCancellationNoExecution:noExecution,pageErrors:errors};
}
