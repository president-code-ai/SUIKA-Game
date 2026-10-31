'use strict';
// Uses the installed Edge only. Run after permission for browser/OS side effects.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.verification');
const edge=path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){const result=await fn();if(result)return result;await sleep(80);}throw new Error('Timed out waiting for browser condition');}
async function main(){
  if(process.env.SUIKA_BROWSER_APPROVED!=='1')throw new Error('Set SUIKA_BROWSER_APPROVED=1 only after explicit browser permission.');
  fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'edge-profile-'));const temp=path.join(out,'tmp');fs.mkdirSync(temp,{recursive:true});
  const log=fs.openSync(path.join(out,'edge.log'),'a');
  // Keep browser protection enabled. This can fail to start renderers inside
  // a managed host sandbox; do not silently weaken protection to work around it.
  const child=spawn(edge,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,`--disk-cache-dir=${path.join(profile,'cache')}`,`--crash-dumps-dir=${path.join(profile,'crashes')}`,'--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-breakpad','--disable-crash-reporter','--disable-background-mode','--metrics-recording-only','--disable-features=msEdgeSidebarV2,EdgeShoppingAssistantEnabled','about:blank'],{cwd:root,env:{...process.env,TEMP:temp,TMP:temp},windowsHide:true,stdio:['ignore',log,log]});
  let ws;const pending=new Map();let seq=0;const errors=[],requests=[];let browserVersion;
  try{
    const portFile=path.join(profile,'DevToolsActivePort');
    await until(()=>{if(child.exitCode!==null)throw new Error(`Edge exited: ${child.exitCode}; inspect .verification/edge.log`);return fs.existsSync(portFile);},20000);
    const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);ws=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}
      else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
      else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);
      else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);
    });
    function command(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
    browserVersion=(await command('Browser.getVersion')).product;
    const {targetId}=await command('Target.createTarget',{url:'about:blank'});const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});const c=(m,p)=>command(m,p,sessionId);
    await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Log.enable');await c('Page.bringToFront');
    await c('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
    await c('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(globalThis,'SuikaCore',{configurable:true,set(core){const Base=core.World;Object.defineProperty(globalThis,'SuikaCore',{value:{...core,World:class extends Base{constructor(){super(()=>0);globalThis.__world=this;}}},configurable:true});}});`});
    const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const snapshot=()=>evaluate(`({score:__world.score,count:__world.bodies.length,time:__world.time,over:__world.over,hidden:document.getElementById('overlay').hidden})`);
    const click=async selector=>{const rect=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await c('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await c('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});};
    const key=async (key,code)=>{await c('Input.dispatchKeyEvent',{type:'keyDown',key,code});await c('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
    const screenshot=async name=>{const {data}=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name),Buffer.from(data,'base64'));};
    await c('Page.navigate',{url:pathToFileURL(path.join(root,'index.html')).href});await until(()=>evaluate(`typeof __world!=='undefined'&&document.getElementById('evolution').children.length===11`));
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);assert.equal((await snapshot()).hidden,true);await screenshot('desktop-start.png');
    // Genuine mouse input, gravity, contact and merge.
    await click('#game');await sleep(650);await click('#game');await until(async()=>(await snapshot()).score===3);assert.equal((await snapshot()).count,1);
    await click('#pause');const frozen=await snapshot();await sleep(300);assert.equal((await snapshot()).time,frozen.time);assert.equal(frozen.hidden,false);await screenshot('paused.png');
    await key('Escape','Escape');assert.equal((await snapshot()).hidden,true);await until(async()=>(await snapshot()).time>frozen.time);
    // Restart cancellation preserves the game; confirmation resets it and retains best.
    await click('#restart');await click('#modal-secondary');assert.equal((await snapshot()).score,3);await click('#restart');await click('#modal-primary');assert.equal((await snapshot()).score,0);assert.equal(await evaluate(`document.getElementById('best').textContent`),'3');
    // Keyboard drop, motion and key-repeat protection are also covered by the VM tests.
    await evaluate(`document.getElementById('game').focus()`);await key(' ','Space');assert.equal((await snapshot()).count,1);await sleep(550);
    // Touch input on narrow screens, including drag and release.
    await c('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await c('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await sleep(120);
    const touch=await evaluate(`(()=>{const r=document.getElementById('game').getBoundingClientRect();return{x:r.x+r.width*.25,y:r.y+r.height*.4};})()`);
    await c('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touch,id:1}]});await c('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+40,y:touch.y,id:1}]});await c('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok((await snapshot()).count>=2);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await screenshot('mobile-play.png');
    // Real canvas rendering with every fruit, using a deterministic screenshot fixture.
    await c('Emulation.setTouchEmulationEnabled',{enabled:false});await c('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate(`__world.bodies=[];__world.danger=0;[[10,130,490],[8,300,515],[7,276,378],[6,145,337],[5,70,243],[4,210,268],[3,312,284],[2,350,215],[1,279,241],[0,250,286]].forEach(([l,x,y])=>{const b=__world.body(l,x,y);b.age=10;__world.bodies.push(b);});__world.score=__world.score;`);
    await sleep(1800);await screenshot('desktop-fruits.png');
    // Browser-level game over + restart; source game code remains unchanged.
    await evaluate(`__world.bodies=[];const b=__world.body(0,100,120);b.age=10;__world.bodies.push(b);__world.danger=SuikaCore.C.dangerTime;`);
    await until(async()=>(await snapshot()).over);assert.equal((await snapshot()).hidden,false);await click('#modal-primary');assert.equal((await snapshot()).over,false);
    assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(requests.filter(u=>/^https?:|^wss?:/.test(u)).length,0);
    const report={browser:browserVersion,passed:['file URL load','desktop 1280px layout','mouse drop and physical merge','pause freezes simulation','Escape resumes','restart cancel/confirm and best','keyboard drop','390px touch drag/drop and layout','all-fruit canvas rendering','game over and replay','no page HTTP/WebSocket requests','no JavaScript or CSP errors'],errors,requests,screenshots:['desktop-start.png','paused.png','mobile-play.png','desktop-fruits.png']};
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    await command('Browser.close').catch(()=>{});
  }finally{
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Browser session ended'));}pending.clear();
    if(ws)ws.close();if(child.exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(2500)]);if(child.exitCode===null)child.kill();}fs.closeSync(log);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
