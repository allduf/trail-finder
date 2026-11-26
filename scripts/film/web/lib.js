const { chromium } = require('playwright'); const fs=require('fs'), path=require('path');
const ROOT=process.env.HOME+'/w';
exports.open=async({w=405,h=720,video=null,dsf=2}={})=>{
  const b=await chromium.launch({args:[`--force-device-scale-factor=${dsf}`,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const o={viewport:{width:w,height:h},hasTouch:true,isMobile:false,serviceWorkers:'block',locale:'en-CA',timezoneId:'America/Vancouver',
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'};
  if(video) o.recordVideo=video;
  o.permissions=['clipboard-read','clipboard-write']; const ctx=await b.newContext(o);
  await ctx.addInitScript(()=>{ try{ if(!localStorage.getItem('tf:__init')){ localStorage.setItem('tf:__init','1');
    localStorage.setItem('tf:riskOk',JSON.stringify({avy:{v:3,season:2026,at:'x'},offtrail:{v:1,at:'x'},route:{v:1,at:'x'}}));localStorage.setItem('tf:termsOk',JSON.stringify({v:2,at:'x'}));localStorage.setItem('tf:tipSeen','true');localStorage.setItem('tf:welcomed','true');localStorage.setItem('tf:skiGuest','true');['skiShort','skiMineOff','skiSnowAdded','skiParkAdded'].forEach(k=>localStorage.setItem('tf:'+k,'true'));localStorage.setItem('tf:skiLayers2',JSON.stringify(['tour','hut']));['tf:skiCams','tf:skiLifts','tf:skiSlack'].forEach(k=>localStorage.setItem(k,'false'));localStorage.setItem('tf:avy','false');}}catch(e){}
    let _L; Object.defineProperty(window,'L',{configurable:true,get(){return _L},set(v){_L=v; try{v.Map.addInitHook(function(){ if(!window.__map) window.__map=this; });}catch(e){}}});
    let _M; Object.defineProperty(window,'maplibregl',{configurable:true,get(){return _M},set(v){_M=v; try{const r=v.Map.prototype.resize; v.Map.prototype.resize=function(...a){ window.__gl=this; return r.apply(this,a); };}catch(e){}}}); });
  // fake shared-trips database (demo only)
  const DB={}; let rev=1; exports.DB=DB;
  await ctx.route(/\/rest\/v1\/rpc\/trip_(new|get|put)/, async r=>{ const fn=r.request().url().match(/trip_(\w+)/)[1]; const a=JSON.parse(r.request().postData()||'{}');
    let out; if(fn==='new'){ DB.id='7f3c9a21'; DB.data=a.p_data; DB.rev=1; DB.by=a.p_by; out=DB.id; }
    else if(fn==='get'){ if(DB.hook) DB.hook(DB); out={data:DB.data,rev:DB.rev,by:DB.by}; }
    else { if(a.p_rev!==DB.rev) out={ok:false}; else { DB.data=a.p_data; DB.rev++; DB.by=a.p_by; out={ok:true,rev:DB.rev}; } }
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(out)}); });
  await ctx.route(/trailfinderapp\.ca\//, async r=>{ const u=new URL(r.request().url()); let rel=decodeURIComponent(u.pathname.slice(1))||'index.html'; const f=path.join(ROOT,rel);
    if(fs.existsSync(f)&&fs.statSync(f).isFile()){ const ct={'.js':'application/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'; return r.fulfill({status:200,body:fs.readFileSync(f),headers:{'content-type':ct}});} return r.continue(); });
  const p=await ctx.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
  return {b,ctx,p};
};
