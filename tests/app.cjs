'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const html=readFileSync(join(__dirname,'../SUIKA.html'),'utf8');
function setup(reduced=false){
  const listeners=new Map(),elements=new Map(),frames=[];let world,drawCalls=0;
  const context=new Proxy({}, {get(target,key){if(key==='createRadialGradient')return ()=>({addColorStop(){}});if(key==='measureText')return ()=>({width:10});if(key in target)return target[key];return (...args)=>{for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a),`${String(key)} receives finite coordinates`);if(key==='ellipse'||key==='arc')assert.ok(args[2]>=0);drawCalls++;};},set(t,k,v){t[k]=v;return true;}});
  class Element {
    constructor(id){this.id=id;this.hidden=html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0].includes(' hidden')||false;this.disabled=false;this.textContent='';this.children=[];this.events=new Map();this.attrs=new Map();this.tabIndex=0;}
    getContext(){return context;}setAttribute(k,v){this.attrs.set(k,v);}removeAttribute(k){this.attrs.delete(k);}append(...nodes){this.children.push(...nodes);}focus(){document.activeElement=this;}getBoundingClientRect(){return {left:10,top:20,width:420,height:620};}
    setPointerCapture(){}releasePointerCapture(){}addEventListener(k,f){if(!this.events.has(k))this.events.set(k,[]);this.events.get(k).push(f);}
    emit(k,args={}){const e={key:'',button:0,pointerId:1,pointerType:'mouse',clientX:210,preventDefault(){this.prevented=true;},...args};for(const f of this.events.get(k)||[])f(e);return e;}
    click(){if(!this.disabled)this.emit('click');}
  }
  const document={hidden:false,activeElement:null,getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},createElement(tag){return new Element(tag);},addEventListener(k,f){listeners.set('document:'+k,f);}};
  const window={matchMedia(){return {matches:reduced};},addEventListener(k,f){listeners.set(k,f);}};
  const sandbox={window,document,requestAnimationFrame(f){frames.push(f);},console};
  vm.createContext(sandbox);vm.runInContext(html.match(/<script id="suika-core">([\s\S]*?)<\/script>/)[1],sandbox);
  const core=sandbox.SuikaCore;sandbox.SuikaCore={...core,World:class extends core.World{constructor(){super(()=>0);world=this;}}};
  vm.runInContext(html.match(/<script id="suika-app">([\s\S]*?)<\/script>/)[1],sandbox);
  let now=100;function frame(count=1){for(let i=0;i<count;i++){const f=frames.shift();now+=1000/60;f(now);}}
  function key(k,args={}){listeners.get('keydown')({key:k,repeat:false,preventDefault(){},...args});}
  return {world,core,$:id=>document.getElementById(id),document,window,frame,key,listeners,get drawCalls(){return drawCalls;}};
}
test('initial UI renders all fruits, next preview and finite canvas calls',()=>{
  const app=setup();assert.equal(app.$('evolution').children.length,11);assert.equal(app.$('score').textContent,'0');assert.match(app.$('next').attrs.get('aria-label'),/さくらんぼ/);app.frame(20);assert.ok(app.drawCalls>1000);
});
test('pointer drop and cooldown prevent accidental rapid double drops',()=>{
  const app=setup(),canvas=app.$('game');canvas.emit('pointerdown',{clientX:-200});canvas.emit('pointerup',{clientX:-200});assert.equal(app.world.bodies.length,1);assert.equal(app.world.bodies[0].x,37);
  canvas.emit('pointerdown');canvas.emit('pointerup');assert.equal(app.world.bodies.length,1);app.frame(35);canvas.emit('pointerdown');canvas.emit('pointerup');assert.equal(app.world.bodies.length,2);
});
test('cancelled and secondary pointers do not drop fruit',()=>{
  const app=setup(),c=app.$('game');c.emit('pointerdown',{pointerId:2});c.emit('pointerup',{pointerId:3});assert.equal(app.world.bodies.length,0);c.emit('pointercancel',{pointerId:2});c.emit('pointerup',{pointerId:2});assert.equal(app.world.bodies.length,0);
});
test('cancelling a secondary touch does not cancel the active drag',()=>{
  const app=setup(),c=app.$('game');c.emit('pointerdown',{pointerId:2,pointerType:'touch'});c.emit('pointercancel',{pointerId:3});c.emit('lostpointercapture',{pointerId:3});c.emit('pointerup',{pointerId:2});assert.equal(app.world.bodies.length,1);
});
test('current fruit has a readable name initially and after a drop',()=>{
  const app=setup(),c=app.$('game');assert.match(c.attrs.get('aria-label'),/現在の果物：さくらんぼ/);app.world.next=4;c.emit('keydown',{key:' '});assert.match(c.attrs.get('aria-label'),/現在の果物：かき/);
});
test('keyboard move and drop work without key-repeat drops',()=>{
  const app=setup(),c=app.$('game');c.emit('keydown',{key:'ArrowRight'});app.frame(20);app.listeners.get('keyup')({key:'ArrowRight'});c.emit('keydown',{key:' ',repeat:false});assert.ok(app.world.bodies[0].x>250);app.frame(35);c.emit('keydown',{key:' ',repeat:true});assert.equal(app.world.bodies.length,1);
});
test('pause freezes simulation, blocks input and traps keyboard focus',()=>{
  const app=setup(),c=app.$('game');c.emit('keydown',{key:' '});app.frame(20);app.key('p');const y=app.world.bodies[0].y;app.frame(30);assert.equal(app.world.bodies[0].y,y);assert.equal(app.$('overlay').hidden,false);assert.equal(app.$('pause').disabled,true);assert.equal(c.tabIndex,-1);
  c.emit('pointerdown');c.emit('pointerup');assert.equal(app.world.bodies.length,1);app.key('Tab');assert.equal(app.document.activeElement,app.$('modal-primary'));app.key('Escape');assert.equal(app.$('overlay').hidden,true);assert.equal(c.tabIndex,0);app.frame(10);assert.ok(app.world.bodies[0].y>y);
});
test('restart needs confirmation, cancel preserves progress and best survives restart',()=>{
  const app=setup();app.world.bodies=[app.world.body(0,100,400),app.world.body(0,120,400)];app.frame(4);assert.equal(app.$('score').textContent,'3');
  app.$('restart').click();assert.match(app.$('modal-title').textContent,/はじめから/);app.$('modal-secondary').click();assert.equal(app.world.score,3);
  app.$('restart').click();app.$('modal-primary').click();assert.equal(app.world.score,0);assert.equal(app.world.bodies.length,0);assert.equal(app.$('best').textContent,'3');
});
test('visibility loss automatically pauses and requires explicit resume',()=>{
  const app=setup();app.document.hidden=true;app.listeners.get('document:visibilitychange')();assert.equal(app.$('overlay').hidden,false);app.document.hidden=false;app.listeners.get('document:visibilitychange')();assert.equal(app.$('overlay').hidden,false);app.$('modal-primary').click();assert.equal(app.$('overlay').hidden,true);
});
test('game over shows score and restart clears the previous world',()=>{
  const app=setup();app.world.danger=app.core.C.dangerTime;const b=app.world.body(0,100,120);b.age=10;app.world.bodies=[b];app.frame(4);assert.equal(app.world.over,true);assert.match(app.$('modal-title').textContent,/ひと粒/);app.key('Escape');assert.equal(app.$('overlay').hidden,false);app.$('modal-primary').click();assert.equal(app.world.over,false);assert.equal(app.$('overlay').hidden,true);
});
test('reduced motion mode still renders merges and scores',()=>{
  const app=setup(true);app.world.bodies=[app.world.body(0,100,400),app.world.body(0,120,400)];app.frame(10);assert.equal(app.world.score,3);assert.ok(app.drawCalls>100);
});
