'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const html=readFileSync(join(__dirname,'../SUIKA.html'),'utf8');
const code=html.match(/<script id="suika-core">([\s\S]*?)<\/script>/)[1];
const sandbox={};vm.runInNewContext(code,sandbox);
const {World,C,FRUITS}=sandbox.SuikaCore;
function step(w,n){for(let i=0;i<n;i++)w.step();}

test('11 stages; spawn is restricted to the first five fruit types',()=>{
  assert.equal(FRUITS.length,11);assert.equal(FRUITS.at(-1).name,'スイカ');
  for(const value of [0,.1999,.2,.8,.99999,1,-1,NaN,Infinity]){
    const w=new World(()=>value);assert.ok(w.current>=0&&w.current<=4);assert.ok(w.next>=0&&w.next<=4);
  }
});
test('drop clamps to side walls, rejects invalid coordinates and repeat input',()=>{
  const w=new World(()=>0);assert.equal(w.drop(NaN),false);assert.equal(w.drop(Infinity),false);assert.equal(w.drop(-10000),true);
  assert.equal(w.bodies[0].x,C.left+FRUITS[0].r);assert.equal(w.drop(210),false);
  step(w,59);assert.equal(w.drop(10000),true);assert.equal(w.bodies[1].x,C.right-FRUITS[0].r);
});
test('same fruits merge once, score matches the new stage and unequal fruits remain',()=>{
  const w=new World(()=>0);w.bodies=[w.body(0,100,400),w.body(0,120,400),w.body(3,300,400)];w.step();
  assert.equal(w.bodies.length,2);assert.equal(w.bodies.filter(b=>b.level===1).length,1);assert.equal(w.score,FRUITS[1].points);assert.equal(w.events.length,1);
  assert.equal(w.events[0].level,1);assert.equal(w.bodies.find(b=>b.level===3).r,FRUITS[3].r);
});
test('three-way collision consumes each original fruit at most once',()=>{
  const w=new World(()=>0);w.bodies=[w.body(0,190,400),w.body(0,210,400),w.body(0,230,400)];w.step();
  assert.equal(w.bodies.length,2);assert.equal(w.score,FRUITS[1].points);assert.equal(w.bodies.filter(b=>b.level===0).length,1);
});
test('every stage can grow to watermelon; watermelons do not merge',()=>{
  for(let level=0;level<10;level++){
    const w=new World(()=>0);w.bodies=[w.body(level,180,400),w.body(level,200,400)];w.step();
    assert.equal(w.bodies.length,1);assert.equal(w.bodies[0].level,level+1);assert.equal(w.score,FRUITS[level+1].points);
    assert.equal(w.watermelons,level===9?1:0);
  }
  const w=new World(()=>0);w.bodies=[w.body(10,150,400),w.body(10,260,400)];step(w,120);
  assert.equal(w.bodies.length,2);assert.equal(w.score,0);
});
test('exactly coincident bodies separate with finite positions',()=>{
  const w=new World(()=>0);w.bodies=[w.body(2,210,400),w.body(3,210,400)];step(w,240);
  for(const b of w.bodies){assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.y));assert.ok(b.y+b.r<=C.bottom+.001);}
  assert.ok(Math.hypot(w.bodies[0].x-w.bodies[1].x,w.bodies[0].y-w.bodies[1].y)>20);
});
test('free fall reaches the floor and comes to rest without penetrating it',()=>{
  const w=new World(()=>0);w.drop(210);step(w,1200);const b=w.bodies[0];
  assert.ok(Math.abs(b.y+b.r-C.bottom)<.01);assert.ok(Math.abs(b.vy)<2);assert.equal(w.over,false);
});
test('game over has a spawn grace period, persistent overflow timeout and recovery',()=>{
  const w=new World(()=>0),b=w.body(0,100,120);w.bodies=[b];
  for(let i=0;i<100;i++){b.y=120;b.vy=0;w.step();}assert.equal(w.danger,0);
  b.age=10;for(let i=0;i<120;i++){b.y=120;b.vy=0;w.step();}assert.equal(w.over,false);assert.ok(w.danger>.9);
  b.y=500;step(w,120);assert.equal(w.danger,0);
  for(let i=0;i<260;i++){b.y=120;b.vy=0;w.step();}assert.equal(w.over,true);assert.equal(w.drop(100),false);
  const time=w.time;step(w,30);assert.equal(w.time,time);w.reset();assert.equal(w.over,false);assert.equal(w.score,0);assert.equal(w.bodies.length,0);
});
test('invalid delta time does not advance the world; large delta is bounded',()=>{
  const w=new World(()=>0);for(const dt of [-1,0,NaN,Infinity])w.step(dt);assert.equal(w.time,0);w.step(999);assert.ok(w.time<=1/30);
});
test('long seeded play stays finite and within walls with bounded resource usage',()=>{
  let seed=777;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  let merges=0,ended=0;
  for(let run=0;run<4;run++){
    const w=new World(random);
    for(let tick=0;tick<12000&&!w.over;tick++){
      if(tick%70===0)w.drop(C.left+random()*(C.right-C.left));w.step();
      merges+=w.events.filter(e=>!e.over).length;w.events.length=0;
      assert.ok(w.bodies.length<=C.maxBodies);
      for(const b of w.bodies){assert.ok([b.x,b.y,b.vx,b.vy,b.r,b.angle].every(Number.isFinite));assert.ok(b.x-b.r>=C.left-.001);assert.ok(b.x+b.r<=C.right+.001);assert.ok(b.y+b.r<=C.bottom+.001);}
    }
    if(w.over)ended++;
  }
  assert.ok(merges>25);assert.ok(ended>0);
});
test('distribution is self-contained and has no network, HTML-injection or storage APIs',()=>{
  assert.doesNotMatch(html,/<(?:script|link|img|iframe|audio|video)\b[^>]*(?:src|href)\s*=/i);
  assert.doesNotMatch(html,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|eval)\b|\.innerHTML\s*=/);
  assert.match(html,/connect-src 'none'/);assert.match(html,/lang="ja"/);
});
