import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { Args } from './types.js';

export interface BrowserWorkspace {
  call(method: string, args: Args): Promise<unknown>;
  documentFile(projectId: string, documentId: string): Promise<{ path: string; mime: string; name: string }>;
}
export interface ServerOptions { dataDir: string; cliPath: string; nodePath: string; uiDir: string; port?: number }
const mime: Record<string,string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const methods = new Set(['projects.list','projects.create','projects.rename','projects.delete','repositories.list','repositories.add','repositories.clone','repositories.remove','repositories.files','repositories.read','repositories.search','documents.list','documents.import','documents.upload','documents.read','documents.search','documents.page','documents.delete','system.get','system.save','drafts.list','drafts.propose','drafts.accept','drafts.delete']);
function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage) {
  const buffers: Buffer[] = []; let size = 0;
  for await (const value of request) { const chunk = Buffer.from(value); size += chunk.length; if(size > 46 * 1024 * 1024) throw new Error('Request exceeds the 32 MiB document upload limit.'); buffers.push(chunk); }
  return JSON.parse(Buffer.concat(buffers).toString('utf8')) as unknown;
}
export async function startBrowserServer(workspace: BrowserWorkspace, options: ServerOptions) {
  const token = randomBytes(32).toString('base64url'), expected = Buffer.from(`Bearer ${token}`);
  let authority = '';
  const uiRoot = await realpath(options.uiDir);
  const server = createServer(async (request,response) => {
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if(request.headers.host !== authority) { json(response,403,{error:'Invalid local host.'}); return; }
      if(request.headers.origin && request.headers.origin !== `http://${authority}`) { json(response,403,{error:'Foreign origins are not allowed.'}); return; }
      if(request.headers['sec-fetch-site'] === 'cross-site') { json(response,403,{error:'Cross-site requests are not allowed.'}); return; }
      const url = new URL(request.url ?? '/',`http://${authority}`);
      if(url.pathname === '/health' && request.method === 'GET') { json(response,200,{ok:true,version:'0.1.0'}); return; }
      if(url.pathname.startsWith('/api/')) {
        const supplied = Buffer.from(request.headers.authorization ?? '');
        if(supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) { json(response,401,{error:'Open the workspace link printed by hyperbench start to reconnect.'}); return; }
        if(url.pathname === '/api/config' && request.method === 'GET') { json(response,200,{dataDir:options.dataDir,cliPath:options.cliPath,nodePath:options.nodePath,version:'0.1.0'}); return; }
        if(url.pathname === '/api/call' && request.method === 'POST') {
          if(!request.headers['content-type']?.startsWith('application/json')) { json(response,415,{error:'Use application/json.'}); return; }
          const input = await body(request);
          if(!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request.');
          const {method,args} = input as {method:unknown;args:unknown};
          if(typeof method !== 'string' || !methods.has(method) || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Unknown method or invalid arguments.');
          const result = await workspace.call(method,args as Args);
          json(response,200,{result}); return;
        }
        if(url.pathname === '/api/file' && request.method === 'GET') {
          const projectId = url.searchParams.get('projectId'), documentId = url.searchParams.get('documentId');
          if(!projectId || !documentId) throw new Error('Project and document are required.');
          const file = await workspace.documentFile(projectId,documentId);
          const safeMime = ['application/pdf','text/plain'].includes(file.mime) ? file.mime : 'application/octet-stream';
          response.setHeader('Content-Type',safeMime);
          response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}`);
          await pipeline(createReadStream(file.path),response); return;
        }
        json(response,404,{error:'Unknown endpoint.'}); return;
      }
      if(request.method !== 'GET' && request.method !== 'HEAD') { json(response,405,{error:'Method not allowed.'}); return; }
      const pathname = decodeURIComponent(url.pathname);
      const candidate = path.resolve(uiRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if(!candidate.startsWith(uiRoot + path.sep)) { json(response,404,{error:'Not found.'}); return; }
      let resolved: string;
      try { resolved = await realpath(candidate); if(!resolved.startsWith(uiRoot + path.sep) || !(await stat(resolved)).isFile()) throw new Error(); }
      catch { json(response,404,{error:'Not found.'}); return; }
      response.setHeader('Content-Type',mime[path.extname(resolved)] ?? 'application/octet-stream');
      if(request.method === 'HEAD') response.end(); else response.end(await readFile(resolved));
    } catch(error) {
      if(response.headersSent) response.destroy();
      else json(response,400,{error:error instanceof Error ? error.message : 'Request failed.'});
    }
  });
  server.requestTimeout = 300_000; server.headersTimeout = 15_000;
  await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(options.port ?? 0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();}); });
  const address = server.address(); if(!address || typeof address === 'string') throw new Error('Local server failed to start.');
  authority = `127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= new Promise<void>((resolve,reject) => {
    // An unfinished upload must not hold Ctrl+C open for the five-minute request timeout.
    const deadline = setTimeout(() => server.closeAllConnections(), 1000);
    deadline.unref();
    server.close(error => { clearTimeout(deadline); if(error) reject(error); else resolve(); });
    server.closeIdleConnections();
  });
  return { server, token, origin:`http://${authority}`, url:`http://${authority}/#token=${token}`, close };
}
