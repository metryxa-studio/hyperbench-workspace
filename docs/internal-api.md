# Local workspace interface

`new Workspace(dataDir)` from `src/core/workspace.ts`. `await workspace.call(method, args)` dispatches these methods; `workspace.close()` closes SQLite. UI uses POST /api/call `{method,args}`, returns `{result}` or `{error}`. Auth headers handled by UI client. MCP uses the same Workspace directly over stdio.

Methods (all IDs are strings, required unless marked optional):
- projects.list {} -> Project[]
- projects.create {name} -> Project
- projects.rename {projectId,name} -> Project
- projects.delete {projectId} -> {ok:true}; deletes stored context, NEVER source folders/clones
- benches.list {projectId} -> TestBench[]
- benches.add {projectId,name,description?,host,port?,username?,identityFile?,knownHostsFile?,enabled?} -> TestBench; browser only, port defaults to 22 and enabled defaults to false
- benches.update {projectId,benchId,expectedRevision,name,description?,host,port?,username?,identityFile?,knownHostsFile?,enabled?} -> TestBench; browser only, compare-and-swap
- benches.remove {projectId,benchId,expectedRevision} -> {ok:true}; browser only, compare-and-swap; does not modify the remote host
- benches.test {projectId,benchId} -> BenchCommandResult; fixed harmless SSH probe, allowed while commands are disabled
- benches.execute {projectId,benchId,command,timeoutSeconds?} -> BenchCommandResult; enabled benches only, timeout defaults to 30 seconds and must be 1..300
- repositories.list {projectId} -> Repository[]
- repositories.add {projectId,path} -> Repository; register an existing local directory
- repositories.clone {projectId,url,destination} -> Repository; Git clone into new absolute destination, no overwriting
- repositories.remove {projectId,repositoryId} -> {ok:true}; unlink only
- repositories.files {projectId,repositoryId,query?,limit?,directory?} -> FileList
- repositories.read {projectId,repositoryId,path,startLine?,endLine?} -> SourceRead
- repositories.search {projectId,repositoryId,query,limit?,directory?} -> RepositorySearch; literal bounded on-demand search, no index
- documents.list {projectId} -> DocumentSummary[]
- documents.import {projectId,path} -> DocumentSummary; local path import
- documents.upload {projectId,name,base64} -> DocumentSummary; browser upload, max 32 MiB
- documents.read {projectId,documentId,page?} -> DocumentContent; page optional returns bounded text with coverage
- documents.search {projectId,query,limit?} -> {hits:Array<{documentId,name,page,text}>,truncated:boolean}
- documents.page {projectId,documentId,page,scale?,crop?:{x:number,y:number,width:number,height:number}} -> {data:string,mimeType:'image/png',page:number,width:number,height:number}; crop normalized 0..1
- documents.delete {projectId,documentId} -> {ok:true}
- system.get {projectId} -> SystemModel
- system.save {projectId,system,expectedRevision} -> SystemModel; explicit UI action only, compare-and-swap
- drafts.list {projectId} -> SystemDraft[]
- drafts.propose {projectId,system,baseRevision,summary} -> SystemDraft; MCP writable tool, never overwrites saved system
- drafts.accept {projectId,draftId,expectedRevision} -> SystemModel; UI only, rejects stale drafts
- drafts.delete {projectId,draftId} -> {ok:true}

`await workspace.documentFile(projectId,documentId)` -> `{path,mime,name}` for authenticated original file serving. No model/agent calls from this package. Backend rejects invalid cross-project refs and dangling connections. UI polls drafts every 3 seconds and reflects explicit saves with revision conflicts rather than overwriting.

`TestBench` contains `{id,projectId,name,description,host,port,username?,identityFile?,knownHostsFile?,enabled,revision,createdAt,updatedAt}`. Optional identity and known-hosts file paths must be absolute or start with `~/`. SSH uses key/agent authentication, disables password prompts, and requires an already trusted host key. No password or private-key contents are stored.

`BenchCommandResult` contains `{benchId,command,stdout,stderr,exitCode:number|null,signal:string|null,timedOut:boolean,truncated:boolean,durationMs:number}`. stdout/stderr share a 256 KiB output budget. Nonzero command exits are results, not transport exceptions; callers must check exitCode and completion flags. Timeout stops the local SSH client and cannot guarantee remote process termination. Configuration, ownership, and disabled-bench failures reject the operation.

MCP tools `list_benches`, `bench_test`, and `bench_execute` dispatch to the corresponding bench operations, and `project_context` includes `benches`. There are no MCP tools for bench creation, updates, or removal. Remote command output is untrusted data; command execution can change files and hardware state and remains subject to the calling client's permission policy.
