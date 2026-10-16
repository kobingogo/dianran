import http from 'node:http';
const files=new Map(),requests=[];
let revision=0,holdNext=false,held,ignoreConditions=false;
const write=({res,path,body,match,none})=>{
  const current=files.get(path);
  if(!ignoreConditions&&((match&&match!==current?.etag)||(none==='*'&&current))){res.writeHead(412).end();return;}
  files.set(path,{body,etag:`"${++revision}"`});res.writeHead(201).end();
};
const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4317');
  res.setHeader('Access-Control-Allow-Headers','content-type,authorization,if-match,if-none-match,depth');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,MKCOL,PROPFIND,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers','ETag');
  const path=new URL(req.url,'http://fixture').pathname;
  const json=value=>{res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value));};
  if(req.method==='OPTIONS')return res.writeHead(204).end();
  if(path==='/health')return json({fixture:true});
  if(path==='/fixture/state')return json({held:Boolean(held),requests,manifests:[...files].filter(([p])=>p.endsWith('/manifest.json')).map(([path,f])=>({path,etag:f.etag,value:JSON.parse(f.body.toString())}))});
  if(path==='/fixture/hold'){holdNext=true;return json({ok:true});}
  if(path==='/fixture/release'){const pending=held;held=undefined;if(pending)write(pending);return json({ok:true});}
  if(path==='/fixture/ignore-conditions'){ignoreConditions=true;return json({ok:true});}
  if(req.headers.authorization!=='Basic '+Buffer.from('fixture:fixture-password').toString('base64'))return res.writeHead(401).end();
  requests.push({method:req.method,path,match:req.headers['if-match'],none:req.headers['if-none-match']});
  if(req.method==='MKCOL')return res.writeHead(201).end();
  if(req.method==='PROPFIND')return res.writeHead(207).end();
  if(req.method==='DELETE'){files.delete(path);return res.writeHead(204).end();}
  if(req.method==='GET'){const file=files.get(path);if(!file)return res.writeHead(404).end();return res.writeHead(200,{ETag:file.etag}).end(file.body);}
  if(req.method==='PUT'){
    const body=Buffer.concat(await Array.fromAsync(req));
    const pending={res,path,body,match:req.headers['if-match'],none:req.headers['if-none-match']};
    if(holdNext&&path.endsWith('/canvas/manifest.json')){holdNext=false;held=pending;return;}
    return write(pending);
  }
  res.writeHead(405).end();
});
server.listen(0,'127.0.0.1',()=>process.send?.({url:`http://127.0.0.1:${server.address().port}`}));
process.on('SIGTERM',()=>{held?.res.end();server.closeAllConnections();server.close(()=>process.exit(0));});
