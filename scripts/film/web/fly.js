// Level 3D fly-over: the camera stays at one altitude (m) and moves on a straight line / circle; every frame is rendered
// to completion before the screenshot, so the motion has no lag.
const L=require('./lib.js'), fs=require('fs');
const A=JSON.parse(fs.readFileSync(process.argv[2])); if(A.tripLinesFile){ let t=JSON.parse(fs.readFileSync(A.tripLinesFile,'utf8')); if(Array.isArray(t)) t=t[0]; A.tripLines={way:t.way,lines:t.lines}; } const DSF=+(process.env.DSF||2.6667);
(async()=>{ const {b,ctx,p}=await L.open({dsf:DSF}); const cdp=await ctx.newCDPSession(p);
  if(A.trip) await ctx.addInitScript(t=>{ localStorage.setItem('tf:skiTrips',t); },fs.readFileSync(A.trip,'utf8'));
  await p.goto('https://trailfinderapp.ca/?nowelcome',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(6000);
  await p.evaluate(()=>{window.__map.setView([50.03,-122.87],13,{animate:false});return 1});
  await p.click('#sportMapBtn'); await p.waitForTimeout(800); await p.click('button:visible:text-is("Skiing")'); await p.waitForTimeout(14000);
  if(A.trip){ await p.evaluate(()=>{ window.tfCabinTrip.list(); return 1;}); await p.waitForTimeout(1200); await p.click('[data-trip]'); await p.waitForTimeout(6000);
    await p.evaluate(()=>{ const b=document.querySelector('[data-tp="fitall"]'); b&&b.click(); return 1;}); await p.waitForTimeout(3000); }
  await p.evaluate((A)=>{ const g=window.__gl;
    const st=document.createElement('style'); st.textContent=`.maplibregl-marker{display:${A.markers?'block':'none'}!important} .maplibregl-ctrl{display:none!important}`+(A.markers?'':'')+`*{transition:none!important;animation:none!important}`; document.head.appendChild(st);
    if(A.markers){ /* keep only the hut */ document.querySelectorAll('.maplibregl-marker').forEach(m=>{ if(!m.classList.contains('sk-hutgl')) m.style.setProperty('display','none','important'); }); }
    const c=g.getContainer(); c.style.cssText+=';position:fixed!important;left:0;top:0;width:100vw!important;height:100vh!important;z-index:2147483000;'; g.resize();
    if(A.hide) for(const id of g.getStyle().layers.map(l=>l.id)) if(new RegExp(A.hide,'i').test(id)) { try{g.setLayoutProperty(id,'visibility','none')}catch(e){} }
    if(A.declutter){ const m=window.__map; window.__dc=()=>{ let n=0; m.eachLayer(l=>{ if(l instanceof L.Path){ m.removeLayer(l); n++; } }); if(n) m.fire('trailfocus'); return n; }; window.__dc(); }
    if(A.tripLines){ const t=A.tripLines; const fc=(ls,props)=>({type:'Feature',properties:props,geometry:{type:'MultiLineString',coordinates:ls.map(l=>l.map(p=>[p[1],p[0]]))}});
      const font=(()=>{ try{ return g.getLayoutProperty('trail-names','text-font'); }catch(e){ return null; } })();
      g.addSource('trip',{type:'geojson',data:{type:'FeatureCollection',features:[fc([t.way.line],{c:'#7048e8',n:'Way in'}),...t.lines.map(l=>fc(l.ls,{c:'#e8590c',n:l.name}))]}});
      g.addLayer({id:'trip-case',type:'line',source:'trip',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#fff','line-width':9}});
      g.addLayer({id:'trip-line',type:'line',source:'trip',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['get','c'],'line-width':5.5}});
      if(font) g.addLayer({id:'trip-name',type:'symbol',source:'trip',layout:{'symbol-placement':'line','text-field':['get','n'],'text-font':font,'text-size':15,'text-offset':[0,-1.1]},paint:{'text-color':['get','c'],'text-halo-color':'#fff','text-halo-width':2.2}}); }
    try{ g.setCenterClampedToGround && g.setCenterClampedToGround(false); }catch(e){} g._elevationFreeze=true;
    return 1; },A);
  console.log('layers', await p.evaluate(()=>window.__gl.getStyle().layers.filter(l=>window.__gl.getLayoutProperty(l.id,'visibility')!=='none').map(l=>l.id).join(' ')));
  const dir=A.out; fs.mkdirSync(dir,{recursive:true});
  const lerp=(a,b,t)=>a+(b-a)*t, ease=t=>t*t*(3-2*t);
  const from_=(k)=>''; const frame=async(k)=>{ const u=A.ease===false?k/(A.frames-1):ease(k/(A.frames-1)); let from,to;
    if(A.orbit){ const o=A.orbit, ang=(lerp(o.a0,o.a1,u))*Math.PI/180, R=o.r/111320; from=[o.c[0]+R*Math.sin(ang)/Math.cos(o.c[1]*Math.PI/180), o.c[1]+R*Math.cos(ang)]; to=o.c; }
    else { from=[lerp(A.from[0][0],A.from[1][0],u),lerp(A.from[0][1],A.from[1][1],u)]; to=[lerp(A.to[0][0],A.to[1][0],u),lerp(A.to[0][1],A.to[1][1],u)]; }
    const alt=A.alt, talt=A.talt;
    return p.evaluate(async([from,alt,to,talt])=>{ const g=window.__gl; const el=()=>(g.getCenterElevation?g.getCenterElevation():g.transform.elevation);
      const calc=(h)=>g.calculateCameraOptionsFromTo(new maplibregl.LngLat(from[0],from[1]),alt,new maplibregl.LngLat(to[0],to[1]),h);
      // the map keeps the centre on the ground: aim at the ground's own height there, so the camera itself stays at alt
      let h=g.queryTerrainElevation([to[0],to[1]])||talt; g.jumpTo(calc(h)); if(window.__dc&&window.__dc()) await new Promise(r=>setTimeout(r,400));
      await new Promise(r=>requestAnimationFrame(()=>r())); const t=performance.now(); while(performance.now()-t<15000){ if(g.areTilesLoaded()&&g.loaded()) break; await new Promise(r=>setTimeout(r,60)); }
      await new Promise(r=>setTimeout(r,120));
      for(let q=0;q<12;q++){ g.jumpTo(calc(h)); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const e=el(); if(Math.abs(e-h)<0.5) break; h=e; }
      window.__h=h; return h; },[from,alt,to,talt]); };
  // warm pass: load tiles along the path
  for(let k=0;k<A.frames;k+=Math.max(1,Math.floor(A.frames/12))) await frame(k);
  const only=process.env.ONLY?process.env.ONLY.split(',').map(Number):null;
  for(let k=0;k<A.frames;k++){ const fn=`${dir}/${String(k).padStart(4,'0')}.jpg`; if(only? !only.includes(k) : fs.existsSync(fn)) continue;
    let s=null; for(let q=0;q<4;q++){ const e1=await frame(k); s=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:93}); const e2=await p.evaluate(()=>(window.__gl.getCenterElevation?window.__gl.getCenterElevation():window.__gl.transform.elevation)); if(Math.abs(e2-e1)<0.5) break; console.log('retry',k,e1,e2); } fs.writeFileSync(fn,Buffer.from(s.data,'base64')); if(k%20===0) console.log(dir,k); }
  await b.close(); })().catch(e=>{console.log('FAIL',e);process.exit(1);});
