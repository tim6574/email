// Optional local full-stack preview with in-memory SQLite. Data resets on restart.
// node --experimental-sqlite tests/local-server.mjs
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../worker/index.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const db=new DatabaseSync(':memory:');db.exec(readFileSync(join(root,'worker/migrations/0001_init.sql'),'utf8'));
const DB={prepare(sql){const p=[];return {bind(...args){p.push(...args);return this;},async first(){return db.prepare(sql).get(...p)||null;},async all(){return {results:db.prepare(sql).all(...p)};},async run(){const out=db.prepare(sql).run(...p);return {meta:{changes:Number(out.changes)}};}};}};
const port=Number(process.env.PORT||8000);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,`http://localhost:${port}`).pathname;
  if(path.startsWith('/api/')){
    try {
      const chunks=[];for await(const chunk of req) chunks.push(chunk);
      const request=new Request(`http://localhost:${port}${req.url}`,{method:req.method,headers:req.headers,body:chunks.length?Buffer.concat(chunks):undefined});
      const response=await worker.fetch(request,{DB,ALLOWED_ORIGINS:`http://localhost:${port}`});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    } catch(error) {res.writeHead(500);res.end(String(error));}
    return;
  }
  if(path==='/config.js') {res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});res.end(`window.FRIENDMAIL_API_BASE='http://localhost:${port}/api';`);return;}
  const file=join(root,path==='/'?'index.html':path.slice(1));
  if(!file.startsWith(root) || !['.js','.css','.html','.png','.ico'].includes(extname(file)) || file.includes('/worker/')) {res.writeHead(404);res.end();return;}
  try {const data=readFileSync(file);res.writeHead(200,{'Content-Type':({'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.ico':'image/x-icon'})[extname(file)]});res.end(data);}
  catch {res.writeHead(404);res.end();}
});
server.listen(port,()=>console.log(`Full-stack FriendMail preview: http://localhost:${port}/`));
