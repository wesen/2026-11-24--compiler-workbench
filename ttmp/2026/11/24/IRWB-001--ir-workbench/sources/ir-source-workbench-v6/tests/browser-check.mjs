/**
 * Optional real-browser validation. The implementation has no browser-driver
 * dependency. Install Playwright separately and its Chromium browser, then run:
 *   node tests/browser-check.mjs
 * Overrides: IR_WORKBENCH_PLAYWRIGHT (module path), IR_WORKBENCH_BROWSER
 * (executable), IR_WORKBENCH_BROWSER_ARGS (JSON string array),
 * IR_WORKBENCH_QA_DIR (capture directory). No server is required.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.IR_WORKBENCH_PLAYWRIGHT??'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'output/index.html'),qa=resolve(process.env.IR_WORKBENCH_QA_DIR??resolve(root,'validation/browser'));
await mkdir(qa,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.IR_WORKBENCH_BROWSER?{executablePath:process.env.IR_WORKBENCH_BROWSER}:{}),args:process.env.IR_WORKBENCH_BROWSER_ARGS?JSON.parse(process.env.IR_WORKBENCH_BROWSER_ARGS):['--no-sandbox','--disable-dev-shm-usage']});
const checks=[],errors=[],network=[],captures=[];let result;
try {
  const page=await browser.newPage({viewport:{width:1480,height:1060},deviceScaleFactor:1,acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);};
  const capture=async name=>{await page.screenshot({path:resolve(qa,name),fullPage:true});captures.push(name);};
  const selectTask=async name=>{await page.locator('.search').fill(name);await page.locator('.invocation').click();};
  const stats=async()=>Promise.all((await page.locator('.stat-value').allTextContents()).map(Number));
  await page.goto(pathToFileURL(output).href);await page.waitForSelector('.mesh-canvas');
  const cold=await stats();check('recorded cold run executes real passes',cold[0]>0&&cold[1]===0&&cold[3]===0);
  await selectTask('door/package');await capture('door-desktop.png');
  const slider=page.getByRole('slider',{name:'Assembly motion sample'});await slider.fill('25');await slider.dispatchEvent('input');
  check('door slider selects an actual recorded pose',(await page.locator('.domain-view > .view-status').innerText()).includes('Frame 26/'));
  await page.getByRole('button',{name:'Play assembly',exact:true}).click();await page.waitForTimeout(180);await page.getByRole('button',{name:'Pause assembly',exact:true}).click();
  check('door playback advances recorded sample indices',Number(await slider.inputValue())!==25);
  await page.getByRole('tab',{name:'Why & cache',exact:true}).click();check('cache manifest has inspectable dependency rows',await page.locator('tbody tr').count()>0);await capture('cache-desktop.png');
  await page.getByRole('tab',{name:'Graphs',exact:true}).click();await page.getByRole('button',{name:'Derivation provenance',exact:true}).click();check('provenance graph has real relations',await page.locator('.graph-node').count()>1);await capture('provenance-desktop.png');
  await selectTask('game/package');await page.getByRole('tab',{name:'IR & view',exact:true}).click();await capture('building-desktop.png');
  await page.getByRole('tab',{name:'Decisions',exact:true}).click();check('packaged asset exposes upstream optimization alternatives',(await page.locator('.inspector-content').innerText()).includes('LOD-12'));await capture('decisions-desktop.png');
  await page.locator('#run-picker').selectOption('run-5');await page.getByRole('tab',{name:'Compare',exact:true}).click();check('changed objective exposes a real value diff',await page.locator('tbody tr').count()>0);
  await selectTask('physics/selected');await page.getByRole('tab',{name:'IR & view',exact:true}).click();await page.waitForSelector('.motion-canvas');await capture('physics-desktop.png');
  await page.getByRole('tab',{name:'Query',exact:true}).click();await page.locator('.query-input').fill('cache physics/selected');await page.getByRole('button',{name:'Run query',exact:true}).click();const cacheQuery=JSON.parse(await page.locator('.query-output').innerText());check('query reports a recorded cache hit',cacheQuery.some(x=>x.status==='hit'));
  await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'IR & view',exact:true}).click();await capture('mobile.png');
  check('mobile layout has no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.setViewportSize({width:1480,height:1060});await page.locator('#run-picker').selectOption('run-1');await page.getByRole('tab',{name:'Inputs',exact:true}).click();await capture('inputs-desktop.png');
  const compile=async expected=>{await page.getByRole('button',{name:'Compile edited inputs',exact:true}).click();await page.waitForFunction(n=>document.querySelector('#run-picker')?.options.length===n,expected);return stats();};
  const liveCold=await compile(1);check('browser compiles a fresh project',liveCold[0]===cold[0]&&liveCold[1]===0&&liveCold[3]===0);
  await page.getByRole('tab',{name:'Inputs',exact:true}).click();const liveWarm=await compile(2);check('unchanged live run reuses every artifact',liveWarm[0]===0&&liveWarm[1]===cold[0]&&liveWarm[3]===0);
  await page.getByRole('tab',{name:'Inputs',exact:true}).click();await page.getByRole('textbox',{name:'Input game.columnRadius',exact:true}).fill('0.2');const liveEdit=await compile(3);check('live input edit recomputes a strict subset',liveEdit[0]>0&&liveEdit[0]<cold[0]&&liveEdit[1]>0&&liveEdit[3]===0);
  await page.getByRole('tab',{name:'Inputs',exact:true}).click();await page.getByRole('textbox',{name:'Input cad.holeDiameter',exact:true}).fill('0.2');const liveFailure=await compile(4);await page.waitForSelector('.alert.error');check('invalid geometry retains diagnostics and failed invocations',liveFailure[3]>0);await capture('live-failure-desktop.png');
  await page.getByRole('tab',{name:'Graphs',exact:true}).click();await page.getByRole('button',{name:'Invocation dependencies',exact:true}).click();check('failure graph retains unsuccessful calls',(await page.locator('.graph-svg').textContent()).includes('failed'));
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export trace JSON',exact:true}).click()]);await download.saveAs(resolve(qa,'exported-live-trace.json'));const exported=JSON.parse(await readFile(resolve(qa,'exported-live-trace.json'),'utf8'));check('live trace export preserves all local runs',exported.runs.length===4&&exported.runs[3].status==='failed');
  check('no uncaught browser errors',errors.length===0);check('no HTTP or HTTPS requests from the workbench',network.length===0);
  result={status:'passed',browser:await browser.version(),file:'output/index.html',sha256:createHash('sha256').update(await readFile(output)).digest('hex'),viewports:[{width:1480,height:1060},{width:390,height:844}],checks,errors,networkRequests:network,counts:{recordedCold:cold,liveCold,liveWarm,liveColumnEdit:liveEdit,liveFailure},countColumns:['executed','cached','decisions','failed'],captures};
  await writeFile(resolve(qa,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
