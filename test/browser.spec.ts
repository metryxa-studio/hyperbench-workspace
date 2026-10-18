import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/core/workspace';
import { startBrowserServer } from '../src/server';
import { pdfFixture } from './pdf-fixture';
let directory:string, workspace:Workspace, local:Awaited<ReturnType<typeof startBrowserServer>>;
let projectId:string;
test.beforeEach(async({page})=>{
 directory=await mkdtemp(path.join(tmpdir(),'hb-browser-'));workspace=new Workspace(path.join(directory,'data'));
 local=await startBrowserServer(workspace,{dataDir:path.join(directory,'data'),cliPath:path.resolve('bin/hyperbench.mjs'),nodePath:process.execPath,uiDir:path.resolve('dist/ui')});
 await page.goto(local.url);
});
test.afterEach(async()=>{await local?.close();workspace?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function createProject(page:any) {
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await page.getByLabel('New project name').fill('Flight controller');
 await page.getByRole('dialog').getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.getByRole('heading',{name:'System',exact:true})).toBeVisible();
 projectId=(await workspace.call('projects.list',{}) as any[])[0].id;
}
async function component(page:any,name='Controller'){
 await page.getByRole('button',{name:'Add component',exact:true}).first().click();
 await page.getByLabel('Component name').fill(name);
 await page.getByRole('dialog').getByRole('button',{name:'Add component',exact:true}).click();
}
async function save(page:any){await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('banner').getByText('Saved',{exact:true})).toHaveText('Saved');}

test('onboarding, component editing and save survive browser reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await createProject(page);await component(page);await save(page);
 expect((await workspace.call('system.get',{projectId}) as any).components[0].label).toBe('Controller');
 await page.reload();await expect(page.locator('.canvas-node').filter({hasText:'Controller'})).toBeVisible();
 await page.getByRole('button',{name:'Connect agent',exact:false}).click();
 await expect(page.getByRole('dialog')).toContainText('mcp');
 expect(errors).toEqual([]);
});

test('repository files and source search work without indexing',async({page})=>{
 await createProject(page);
 const repo=path.join(directory,'firmware');await mkdir(repo);await writeFile(path.join(repo,'sensor.c'),'int temperature = 42;\n');await writeFile(path.join(repo,'.env'),'SECRET=do-not-show');
 await page.getByRole('navigation').getByRole('button',{name:/Repositories/}).click();
 await page.getByRole('button',{name:'Add repository',exact:true}).first().click();
 await page.getByLabel('Absolute folder path').fill(repo);
 await page.getByRole('dialog').getByRole('button',{name:'Add repository',exact:true}).click();
 await page.getByRole('button',{name:'sensor.c',exact:true}).click();
 await expect(page.getByLabel('Source of sensor.c')).toContainText('int temperature = 42;');
 await expect(page.getByRole('button',{name:'.env',exact:true})).toHaveCount(0);
 await page.getByLabel('Search repository content').fill('temperature');await page.getByRole('button',{name:'Search code',exact:true}).click();
 await expect(page.locator('.search-results')).toContainText('sensor.c');
});

test('document upload, component link, save and link removal are coherent',async({page})=>{
 await createProject(page);await component(page);await save(page);
 await page.getByRole('navigation').getByRole('button',{name:/Documents/}).click();
 await page.getByLabel('Upload documents').setInputFiles({name:'board.txt',mimeType:'text/plain',buffer:Buffer.from('Controller pin 3 carries temperature data.')});
 await expect(page.locator('.document-text')).toContainText('Controller pin 3');
 await page.getByRole('button',{name:'Link to system or code'}).click();
 const id=(await workspace.call('system.get',{projectId}) as any).components[0].id;
 await page.getByLabel('Component (optional)').selectOption(id);
 await page.getByRole('button',{name:'Add context link'}).click();
 await page.getByRole('button',{name:'Save system',exact:true}).click();
 await expect(page.getByRole('banner').getByText('Saved',{exact:true})).toHaveText('Saved');
 expect((await workspace.call('system.get',{projectId}) as any).links.length).toBe(1);
 await page.getByRole('button',{name:'Remove document link'}).click();
 await page.getByRole('button',{name:'Save system',exact:true}).click();
 await expect(page.getByRole('banner').getByText('Saved',{exact:true})).toHaveText('Saved');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete document',exact:true}).click();
 await expect(page.getByRole('heading',{name:'No documents'})).toBeVisible();
 expect((await workspace.call('documents.list',{projectId}) as any[]).length).toBe(0);
});

test('an external agent draft is visible for review and only explicit acceptance saves it',async({page})=>{
 await createProject(page);
 const model:any=await workspace.call('system.get',{projectId});
 model.components=[{id:'temperature',label:'Temperature sensor',kind:'hardware',description:'Proposed local sensor',x:100,y:100,ports:[],evidence:[]}];
 await workspace.call('drafts.propose',{projectId,baseRevision:0,summary:'Add temperature sensor',system:model});
 expect((await workspace.call('system.get',{projectId}) as any).components.length).toBe(0);
 await page.getByRole('button',{name:/Agent drafts/}).click();
 await expect(page.getByRole('dialog')).toContainText('Add temperature sensor');
 await page.getByRole('button',{name:'Review on canvas'}).click();
 await expect(page.getByText('Temperature sensor',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Accept & save',exact:true}).click();
 await expect(page.getByRole('banner').getByText('Saved',{exact:true})).toHaveText('Saved');
 await expect.poll(async()=>(await workspace.call('system.get',{projectId}) as any).components.length).toBe(1);
});

test('stale external edits cannot overwrite a browser draft',async({page})=>{
 await createProject(page);await component(page,'Unsaved controller');
 const latest:any=await workspace.call('system.get',{projectId});await workspace.call('system.save',{projectId,expectedRevision:0,system:{...latest,title:'Updated elsewhere'}});
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Revision conflict');
 expect((await workspace.call('system.get',{projectId}) as any).title).toBe('Updated elsewhere');
 await expect(page.getByText('Unsaved controller',{exact:true}).first()).toBeVisible();
});


test('PDF pages render, extracted text is readable and original download preserves bytes',async({page})=>{
 await createProject(page);
 await page.getByRole('navigation').getByRole('button',{name:/Documents/}).click();
 const pdf=pdfFixture(2);
 await page.getByLabel('Upload documents').setInputFiles({name:'connector.pdf',mimeType:'application/pdf',buffer:pdf});
 await expect(page.getByRole('img',{name:'Page 1 of connector.pdf'})).toBeVisible();
 await page.getByLabel('Page number').selectOption('2');
 const image=page.getByRole('img',{name:'Page 2 of connector.pdf'});
 await expect(image).toBeVisible();
 await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
 await expect(page.getByRole('button',{name:'Next page'})).toBeDisabled();
 await page.getByRole('button',{name:'Extracted text',exact:true}).click();
 await expect(page.locator('.document-text')).toContainText('Hardware context');
 const pending=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download original document'}).click();
 const download=await pending;expect(download.suggestedFilename()).toBe('connector.pdf');
 expect(await readFile((await download.path())!)).toEqual(pdf);
});

test('connections save when optional ports are cleared or endpoints change',async({page})=>{
 await createProject(page);await component(page,'Controller');
 await page.getByLabel('Ports',{exact:true}).fill('TX');await page.getByLabel('Description',{exact:true}).click();
 await component(page,'Sensor');
 await page.getByLabel('Ports',{exact:true}).fill('RX');await page.getByLabel('Description',{exact:true}).click();
 await page.getByRole('button',{name:'Connect',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByLabel('From',{exact:true}).selectOption({label:'Controller'});
 await dialog.getByLabel('To',{exact:true}).selectOption({label:'Sensor'});
 await dialog.getByLabel('Connection label').fill('Serial');
 await dialog.getByRole('button',{name:'Add connection',exact:true}).click();
 await page.getByLabel('From port',{exact:true}).fill('TX');
 await page.getByLabel('To port',{exact:true}).fill('RX');await save(page);
 await page.getByLabel('From port',{exact:true}).fill('');await save(page);
 let saved:any=await workspace.call('system.get',{projectId});expect(saved.connections[0].fromPort).toBeUndefined();
 await page.getByLabel('From port',{exact:true}).fill('TX');
 await page.getByLabel('From',{exact:true}).selectOption({label:'Sensor'});
 await page.getByLabel('To',{exact:true}).selectOption({label:'Controller'});
 await save(page);saved=await workspace.call('system.get',{projectId});
 expect(saved.connections[0].fromPort).toBeUndefined();expect(saved.connections[0].toPort).toBeUndefined();
});

test('narrow layout keeps navigation, editing and save reachable',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});
 await createProject(page);await component(page,'Controller');
 await expect(page.getByLabel('Name',{exact:true})).toBeVisible();
 await page.getByLabel('Name',{exact:true}).fill('Updated controller');
 await page.getByRole('button',{name:'Deselect item'}).click();await save(page);
 await page.reload();
 const node=page.getByRole('button',{name:'Updated controller, hardware component'});
 await expect(node).toBeVisible();
 await expect.poll(async()=>{const n=await node.boundingBox(),c=await page.locator('.canvas').boundingBox();return !!n&&!!c&&n.x>=c.x&&n.x+n.width<=c.x+c.width;}).toBe(true);
 await page.screenshot({path:testInfo.outputPath('workspace-narrow.png')});
 await page.getByRole('navigation').getByRole('button',{name:/Documents/}).click();
 await expect(page.getByRole('heading',{name:'Documents',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Import documents',exact:true}).first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
