# Local workspace interface

`new Workspace(dataDir)` from `src/core/workspace.ts`. `await workspace.call(method, args)` dispatches these methods; `workspace.close()` closes SQLite. UI uses POST /api/call `{method,args}`, returns `{result}` or `{error}`. Auth headers handled by UI client. MCP uses the same Workspace directly over stdio.

Methods (all IDs are strings, required unless marked optional):
- projects.list {} -> Project[]
- projects.create {name} -> Project
- projects.rename {projectId,name} -> Project
- projects.delete {projectId} -> {ok:true}; deletes stored context, NEVER source folders/clones
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
