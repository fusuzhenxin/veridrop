import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function fixture() {
  const source=fs.readFileSync(new URL('../src/ad-tracking.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  const events={},requests=[],timers=new Map();let intersection,cleanup,timerId=0;
  const node={dataset:{vdStation:'https://api.example.com/register',vdPlace:'directory-row'},isConnected:true,closest:()=>null,parentElement:{closest:()=>null}};
  const document={hidden:false,body:{},querySelectorAll:()=>[node],addEventListener:(n,fn)=>events[n]=fn,removeEventListener:n=>delete events[n]};
  const context={URL,URLSearchParams,Set,Map,JSON,Math,Date,document,navigator:{webdriver:false},
    useLocation:()=>({pathname:'/list',search:''}),useAds:()=>({footer:[{id:1,targetHost:'api.example.com'}]}),
    useEffect:fn=>cleanup=fn(),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    fetch:(_url,opts)=>{requests.push(JSON.parse(opts.body));return Promise.resolve();},
    IntersectionObserver:class{constructor(fn){intersection=fn;}observe(){}unobserve(){}disconnect(){}},
    MutationObserver:class{observe(){}disconnect(){}}};
  context.globalThis=context;
  vm.runInNewContext(source+'\nuseAdAnalytics();',context);
  return{requests,timers,events,node,document,context,cleanup,intersect:ratio=>intersection([{target:node,isIntersecting:ratio>0,intersectionRatio:ratio}]),tick:()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}

test('50% visibility must persist, hidden pages do not count, each entrance once',()=>{
  const f=fixture();f.intersect(.4);f.tick();assert.equal(f.requests.length,0);
  f.intersect(.6);f.document.hidden=true;f.events.visibilitychange();f.tick();assert.equal(f.requests.length,0);
  f.document.hidden=false;f.events.visibilitychange();f.tick();assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].action,'impression');f.intersect(0);f.intersect(.7);f.tick();assert.equal(f.requests.length,1);f.cleanup();
});
test('directory left/middle clicks counted once; buttons ignored and webdriver identified',()=>{
  const f=fixture();const target={closest:s=>s==='button,input,select,textarea'?null:f.node};
  f.events.click({target,button:0,isTrusted:true,type:'click'});
  f.events.auxclick({target,button:1,isTrusted:true,type:'auxclick'});
  f.events.auxclick({target,button:2,isTrusted:true,type:'auxclick'});
  assert.equal(f.requests.length,2);assert.equal(f.requests[0].automated,false);
  f.context.navigator.webdriver=true;f.events.click({target,button:0,isTrusted:true,type:'click'});
  assert.equal(f.requests[2].automated,true);assert.equal(f.requests[2].path,'/list');
  f.events.click({target:{closest:()=>({})},button:0,type:'click'});assert.equal(f.requests.length,3);f.cleanup();
});
test('banner clicks rely on redirect only, never a second beacon',()=>{
  const f=fixture();f.node.dataset={adId:'1',vdAd:'footer'};f.node.href='https://example.com/go/1?placement=footer';
  const target={closest:s=>s==='button,input,select,textarea'?null:f.node};
  f.events.click({target,button:0,isTrusted:true,type:'click'});assert.equal(f.requests.length,0);f.cleanup();
});

test('exposure-only cards count visibility but ignore blank-area and feedback clicks',()=>{
  const f=fixture();f.node.dataset.vdExposureOnly='';f.node.dataset.vdPlace='vote-row';
  f.intersect(.8);f.tick();assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].action,'impression');
  const target={closest:s=>s==='button,input,select,textarea'?null:f.node};
  f.events.click({target,button:0,isTrusted:true,type:'click'});
  assert.equal(f.requests.length,1);
  const link={dataset:{vdStation:'https://api.example.com/register',vdPlace:'vote'},closest:()=>null};
  f.events.click({target:{closest:s=>s==='button,input,select,textarea'?null:link},button:0,isTrusted:true,type:'click'});
  assert.equal(f.requests.length,2);assert.equal(f.requests[1].placement,'vote');f.cleanup();
});
