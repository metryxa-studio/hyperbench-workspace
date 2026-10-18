import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Workspace } from './core/workspace.js';
import { startBrowserServer } from './server.js';
import { startMcp } from './mcp.js';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = path.join(packageDir,'bin','hyperbench.mjs');
const help = `Hyperbench Workspace — local hardware context for your own agent

  hyperbench start [--port 4318] [--no-open]    Open the browser workspace
  hyperbench mcp [--project ID]                Run MCP over stdio
  hyperbench connect CLIENT [--project ID]     Print agent connection settings
  hyperbench skills --destination PATH        Copy portable skills into a folder
  hyperbench doctor                          Check local installation and database

All commands accept --data-dir PATH (default ~/.hyperbench/workspace).
CLIENT: codex, claude, cursor, gemini, generic. No account or API key is needed.
Node.js 22.13+ is required. Git is only needed for cloning and Git metadata.
The package contains no code indexer, cloud service, or agent runtime.
`;
function q(value:string) { return `'${value.replace(/'/g,"'\\''")}'`; }
export function connectionSettings(client:string,dataDir:string,projectId?:string) {
  const args = [cliPath,'mcp','--data-dir',dataDir,...(projectId?['--project',projectId]:[])];
  if(client === 'codex') return `[mcp_servers.hyperbench]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(args)}\n`;
  if(client === 'claude') return `claude mcp add --transport stdio --scope user hyperbench -- ${[process.execPath,...args].map(q).join(' ')}\n`;
  if(!['cursor','gemini','generic'].includes(client)) throw new Error('Choose codex, claude, cursor, gemini, or generic.');
  return JSON.stringify({mcpServers:{hyperbench:{command:process.execPath,args}}},null,2)+'\n';
}
async function main() {
  const {positionals,values} = parseArgs({allowPositionals:true,options:{'data-dir':{type:'string'},project:{type:'string'},port:{type:'string'},'no-open':{type:'boolean'},destination:{type:'string'},help:{type:'boolean',short:'h'},version:{type:'boolean',short:'v'}}});
  if(values.version) { console.log('0.1.0'); return; }
  if(values.help || !positionals.length) { console.log(help); return; }
  const dataDir = path.resolve(values['data-dir'] ?? process.env.HYPERBENCH_DATA_DIR ?? path.join(homedir(),'.hyperbench','workspace'));
  const command = positionals[0];
  if(command === 'connect') {
    const client = positionals[1] ?? 'generic';
    console.log(connectionSettings(client,dataDir,values.project));
    console.error(client === 'codex' ? 'Add this section to ~/.codex/config.toml, preserving existing settings, then reconnect the agent.' : client === 'claude' ? 'Run the command above, then reconnect the agent.' : 'Add this entry to your agent’s MCP configuration, preserving existing settings, then reconnect.');
    return;
  }
  if(command === 'skills') {
    if(!values.destination) throw new Error('Choose a skill directory with --destination PATH. Existing skill folders are never overwritten.');
    const destination = path.resolve(values.destination);
    const names = ['hardware-retrieval','hardware-debugging','hardware-pr-review'];
    for(const name of names) { try { await access(path.join(destination,name)); throw new Error(`Already exists: ${path.join(destination,name)}. Choose another destination or remove it yourself.`); } catch(error) { if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    await mkdir(destination,{recursive:true});
    for(const name of names) await cp(path.join(packageDir,'skills',name),path.join(destination,name),{recursive:true,errorOnExist:true,force:false});
    console.log(`Installed ${names.join(' and ')} in ${destination}.`); return;
  }
  if(!['start','mcp','doctor'].includes(command)) throw new Error(`Unknown command: ${command}. Run hyperbench --help.`);
  const workspace = new Workspace(dataDir);
  if(command === 'doctor') {
    try {
      const projects = await workspace.call('projects.list',{});
      await access(path.join(packageDir,'dist','ui','index.html'));
      const git = await new Promise<boolean>(resolve=>{const child=spawn('git',['--version'],{stdio:'ignore'});child.on('error',()=>resolve(false));child.on('exit',code=>resolve(code===0));});
      console.log(JSON.stringify({ok:true,node:process.version,dataDir,projects:Array.isArray(projects)?projects.length:0,ui:true,git,codeIndexer:false,cloudService:false},null,2));
    } finally { workspace.close(); }
    return;
  }
  if(command === 'mcp') {
    if(values.project) {
      const projects = await workspace.call('projects.list',{}) as {id:string}[];
      if(!projects.some(project=>project.id===values.project)) { workspace.close(); throw new Error('Configured project does not exist. Open the workspace and reconnect to a current project.'); }
    }
    const server = await startMcp(workspace,values.project);
    let closing=false;
    const shutdown=async()=>{if(closing)return;closing=true;await server.close();workspace.close();};
    process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});process.stdin.once('end',()=>{void shutdown();});
    return;
  }
  const port = values.port === undefined ? 0 : Number(values.port);
  if(!Number.isInteger(port) || port < 0 || port > 65535) { workspace.close(); throw new Error('Port must be an integer between 0 and 65535.'); }
  let local;
  try { local = await startBrowserServer(workspace,{dataDir,cliPath,nodePath:process.execPath,uiDir:path.join(packageDir,'dist','ui'),port}); }
  catch(error) { workspace.close(); throw error; }
  console.log(`Hyperbench Workspace\n${local.url}\n\nData stays in ${dataDir}\nKeep this process running. Press Ctrl+C to stop.`);
  if(!values['no-open']) {
    const executable = process.platform==='darwin'?'open':process.platform==='win32'?'explorer.exe':'xdg-open';
    const child=spawn(executable,[local.url],{detached:true,stdio:'ignore'});
    child.once('error',()=>console.error('Open the local URL above in your browser.')); child.unref();
  }
  let stopping=false;
  const shutdown=async()=>{if(stopping)return;stopping=true;await local.close();workspace.close();};
  process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
