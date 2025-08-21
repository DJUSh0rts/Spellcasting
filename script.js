(function(){
  // --- State ---
  const state = {
    spellName: '',
    settings: { delay: 50, loadedSpell: 'incendio' },
    afterFunction: '', // plain text for the after-cast function
    points: [ { commands: [], offset: {x:0,y:0,z:0} } ],
    selected: 0,
  };

  // --- DOM ---
  const $ = (s)=>document.querySelector(s);
  const pointsListEl = $('#pointsList');
  const selectedLabelEl = $('#selectedLabel');
  const previewEl = $('#preview');
  const statusEl = $('#status');

  const nameInput = $('#spellName');
  const offX = $('#offsetX');
  const offY = $('#offsetY');
  const offZ = $('#offsetZ');
  const spellDelayEl  = $('#spellDelay');
  const loadedSpellEl = $('#loadedSpell');
  const loadedSpellLabel = $('#loadedSpellLabel');
  const afterFunctionEl = $('#afterFunction');

  [offX, offY, offZ].forEach(i=>{ if(i){ i.step='any'; i.inputMode='decimal'; } });

  // --- Grids ---
  const grid = document.getElementById('gridCanvas');
  const thumb = document.getElementById('gridThumb');
  const overviewSvg = document.getElementById('overviewSvg');

  const CELLS=6, SIZE=180, CELL=SIZE/CELLS, RANGE=CELLS/2; // -3..+3

  // --- Storage ---
  const save = ()=>{ try{ localStorage.setItem('spellcast_site_v2', JSON.stringify(state)); }catch{} };
  const load = ()=>{ try{
    const raw=localStorage.getItem('spellcast_site_v2'); if(!raw) return;
    const s=JSON.parse(raw);
    if(s){
      state.spellName = s.spellName || '';
      state.settings  = s.settings ? { delay: (+s.settings.delay||50), loadedSpell: s.settings.loadedSpell || 'incendio' } : { delay: 50, loadedSpell: 'incendio' };
      state.afterFunction = s.afterFunction || '';
      state.points = Array.isArray(s.points) && s.points.length ? s.points.map(p=>({
        commands:(p.commands||[]).map(String),
        offset: p.offset? {x:+p.offset.x||0, y:+p.offset.y||0, z:+p.offset.z||0}:{x:0,y:0,z:0}
      })) : state.points;
      state.selected = Math.min(+s.selected||0, state.points.length-1);
    }
  }catch{} };
  load();

  // init inputs
  if(nameInput) nameInput.value = state.spellName;
  if(spellDelayEl)  spellDelayEl.value  = state.settings.delay;
  if(loadedSpellEl) loadedSpellEl.value = state.settings.loadedSpell;
  if(loadedSpellLabel) loadedSpellLabel.textContent = state.settings.loadedSpell;
  if(afterFunctionEl) afterFunctionEl.value = state.afterFunction;

  // --- Renderers ---
  function renderPoints(){
    if(!pointsListEl) return;
    pointsListEl.innerHTML='';
    state.points.forEach((p,i)=>{
      const el = document.createElement('div');
      el.className = 'point-item' + (i===state.selected?' active':'');
      el.innerHTML = `
        <div class="point-meta">
          <span class="badge">#${i}</span>
          <div class="muted">${p.commands?.length||0} cmd${(p.commands?.length||0)===1?'':'s'} · (${fmt(p.offset.x)}, ${fmt(p.offset.y)}, ${fmt(p.offset.z)})</div>
        </div>`;
      el.addEventListener('click', ()=>{ state.selected=i; rerender(); });
      pointsListEl.appendChild(el);
    });
  }

  function renderEditor(){
    if(selectedLabelEl) selectedLabelEl.textContent = `Point ${state.selected}`;
    const p = state.points[state.selected];
    if(offX) offX.value = p.offset.x;
    if(offY) offY.value = p.offset.y;
    if(offZ) offZ.value = p.offset.z;
    updateThumb();
    renderOverview();
  }

  function renderPreview(){
    if(!previewEl) return;
    const i = state.selected;
    const p = state.points[i];
    const lines = [];

    // Point 0 header
    if(i===0){
      const sn = state.spellName || '<spellName>';
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.spell_name set value ${sn}`);
    }

    // User commands (if any)
    for(const cmd of (p.commands||[])){ if(cmd && cmd.trim()) lines.push(cmd.trim()); }

    // Non-final vs final point
    if(i < state.points.length - 1){
      lines.push(`$function spellcasting:spawn_spell_point {UUID:$(UUID),ox:${trimFloat(p.offset.x)},oy:${trimFloat(p.offset.y)},oz:${trimFloat(p.offset.z)}}`);
    } else {
      // ===== EXACT LAST-POINT FORMAT =====
      lines.push(`# Set Spell Delay // add option to change on website`);
      lines.push(`scoreboard players set @s spell_delay ${state.settings.delay}`);
      lines.push(``);
      lines.push(`# Set function to run after delay // add option to change on website // this is what happens after the spell is completed`);
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".loaded_spell set value ${state.settings.loadedSpell}`);
      lines.push(``);
      lines.push(`# Keep this exact formatting`);
      lines.push(`$kill @e[tag=spell_pos,nbt={data:{owner:$(UUID)}}]`);
      lines.push(`$kill @e[tag=spell_point,nbt={data:{owner:$(UUID)}}]`);
      lines.push(``);
      lines.push(`# This is the same`);
    }

    // Always append the pointer
    lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.next_func set value ${i+1}`);

    previewEl.textContent = lines.join('\n');
    updateThumb();
    renderOverview();
  }

  function rerender(){ renderPoints(); renderEditor(); renderPreview(); save(); }

  // --- XY editor grid helpers ---
  function clientToXY(evt){
    const r = grid.getBoundingClientRect();
    const xpx = Math.min(Math.max(0,(evt.clientX??evt.touches?.[0]?.clientX)-r.left), SIZE);
    const ypx = Math.min(Math.max(0,(evt.clientY??evt.touches?.[0]?.clientY)-r.top), SIZE);
    const x = (xpx - SIZE/2) / CELL;     // right is +x
    const y = (SIZE/2 - ypx) / CELL;     // up is +y
    return {x: clamp(x,-RANGE,RANGE), y: clamp(y,-RANGE,RANGE)};
  }
  function updateThumb(){
    if(!grid || !thumb) return;
    const p = state.points[state.selected];
    const xpx = (p.offset.x * CELL) + SIZE/2;
    const ypx = SIZE/2 - (p.offset.y * CELL);
    thumb.style.left = (xpx-5)+'px';
    thumb.style.top  = (ypx-5)+'px';
  }
  function setXYFromGrid(evt){
    const {x,y} = clientToXY(evt);
    const p = state.points[state.selected];
    p.offset.x = round2(x); p.offset.y = round2(y);
    if(offX) offX.value = p.offset.x;
    if(offY) offY.value = p.offset.y;
    renderPreview(); save();
  }

  // Grid events
  if(grid){
    let dragging=false;
    grid.addEventListener('pointerdown', e=>{ dragging=true; try{grid.setPointerCapture(e.pointerId);}catch{} setXYFromGrid(e); });
    grid.addEventListener('pointermove', e=>{ if(dragging) setXYFromGrid(e); });
    grid.addEventListener('pointerup',   e=>{ dragging=false; try{grid.releasePointerCapture(e.pointerId);}catch{} });
    grid.addEventListener('pointerleave',()=>{ dragging=false; });
  }

  // --- Overview path drawing ---
  function renderOverview(){
    if(!overviewSvg) return;
    const pts = state.points.map(p=>({
      x: (p.offset.x*CELL)+SIZE/2,
      y: SIZE/2 - (p.offset.y*CELL)
    }));
    overviewSvg.innerHTML='';

    // Lines
    for(let i=0; i<pts.length-1; i++){
      const a=pts[i], b=pts[i+1];
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
      line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
      line.setAttribute('stroke','#38bdf8');
      line.setAttribute('stroke-width','2');
      line.setAttribute('stroke-linecap','round');
      overviewSvg.appendChild(line);
    }
    // Nodes
    pts.forEach((p,idx)=>{
      const g=document.createElementNS('http://www.w3.org/2000/svg','g');
      const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx',p.x); c.setAttribute('cy',p.y); c.setAttribute('r','7');
      c.setAttribute('fill', idx===state.selected ? '#22d3ee' : '#38bdf8');
      c.setAttribute('opacity', '0.95');
      const t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',p.x); t.setAttribute('y',p.y+3);
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size','9');
      t.setAttribute('font-weight','700');
      t.setAttribute('fill','#0b1020');
      t.textContent = idx;
      g.appendChild(c); g.appendChild(t); overviewSvg.appendChild(g);
    });
  }

  // --- Buttons & inputs ---
  $('#addPointBtn')?.addEventListener('click',()=>{
    state.points.push({commands:[], offset:{x:0,y:0,z:0}});
    state.selected = state.points.length-1;
    rerender();
  });

  $('#clearPointBtn')?.addEventListener('click',()=>{ 
    if(!state.points[state.selected]) return;
    state.points[state.selected].commands=[]; 
    renderEditor(); renderPreview(); save(); 
  });

  $('#deletePointBtn')?.addEventListener('click',()=>{ 
    if(state.points.length===1){ alert('Need at least one point'); return; } 
    state.points.splice(state.selected,1); 
    state.selected=Math.max(0,state.selected-1); 
    rerender(); 
  });

  $('#addCmdBtn')?.addEventListener('click',()=>{ 
    state.points[state.selected].commands = state.points[state.selected].commands || [];
    state.points[state.selected].commands.push(''); 
    renderEditor(); save(); 
  });

  nameInput?.addEventListener('input',()=>{ state.spellName=nameInput.value.trim(); renderPreview(); save(); });

  offX?.addEventListener('input',()=>{ const v=parseFloat(offX.value); if(!isNaN(v)){ state.points[state.selected].offset.x=v; renderPreview(); updateThumb(); } });
  offY?.addEventListener('input',()=>{ const v=parseFloat(offY.value); if(!isNaN(v)){ state.points[state.selected].offset.y=v; renderPreview(); updateThumb(); } });
  offZ?.addEventListener('input',()=>{ const v=parseFloat(offZ.value); if(!isNaN(v)){ state.points[state.selected].offset.z=v; renderPreview(); } });
  $('#resetOffset')?.addEventListener('click',()=>{ if(offX&&offY&&offZ){ offX.value=offY.value=offZ.value=0; } state.points[state.selected].offset={x:0,y:0,z:0}; renderPreview(); updateThumb(); save(); });

  spellDelayEl?.addEventListener('input', ()=>{
    const v = parseInt(spellDelayEl.value, 10);
    if(!Number.isNaN(v)) state.settings.delay = v;
    renderPreview(); save();
  });
  loadedSpellEl?.addEventListener('input', ()=>{
    state.settings.loadedSpell = loadedSpellEl.value.trim();
    if(loadedSpellLabel) loadedSpellLabel.textContent = state.settings.loadedSpell || '';
    renderPreview(); save();
  });
  afterFunctionEl?.addEventListener('input', ()=>{
    state.afterFunction = afterFunctionEl.value;
    save();
  });

  // Export / Import
  $('#exportJson')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({
      spellName: state.spellName,
      settings: state.settings,
      afterFunction: state.afterFunction,
      points: state.points
    },null,2)],{type:'application/json'});
    saveAs(blob,`${safeName(state.spellName)||'spell'}.json`);
  });

  $('#importJson')?.addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const s=JSON.parse(r.result);
        if(!s || !Array.isArray(s.points)) return alert('Invalid JSON file');
        state.spellName=s.spellName||'';
        state.settings = s.settings ? { delay: (+s.settings.delay||50), loadedSpell: s.settings.loadedSpell || 'incendio' } : { delay: 50, loadedSpell: 'incendio' };
        state.afterFunction = s.afterFunction || '';
        state.points=s.points.map(p=>({commands:(p.commands||[]).map(String), offset:p.offset?{x:+p.offset.x||0,y:+p.offset.y||0,z:+p.offset.z||0}:{x:0,y:0,z:0}}));
        state.selected=0;
        if(nameInput) nameInput.value=state.spellName;
        if(spellDelayEl) spellDelayEl.value = state.settings.delay;
        if(loadedSpellEl) loadedSpellEl.value = state.settings.loadedSpell;
        if(loadedSpellLabel) loadedSpellLabel.textContent = state.settings.loadedSpell || '';
        if(afterFunctionEl) afterFunctionEl.value = state.afterFunction;
        rerender();
      }catch(err){ alert('Import failed: '+err.message); }
    };
    r.readAsText(f);
  });

  $('#exportZip')?.addEventListener('click',async()=>{
    if(!state.spellName){ alert('Enter a spell name first'); return; }

    const zip = new JSZip();

    // pack.mcmeta (exact content as requested)
    const packMcmeta = `{
  "pack": {
    "pack_format": 81,
    "description": "Spellcasting extension pack",
    "supported_formats": {
      "min_inclusive": 45,
      "max_inclusive": 81
    }
  }
}`;
    zip.file("pack.mcmeta", packMcmeta + "\n");

    // Directories per your structure
    const base = "data/spellcasting/function/spells/";
    const activateDir = zip.folder(base + "activate");
    const patternsDir = zip.folder(base + "patterns/" + (state.spellName || "spell"));

    // After-cast function file under activate/<loaded_spell>.mcfunction
    const afterName = (state.settings.loadedSpell || "after").replace(/[^a-zA-Z0-9_\\-]/g,"_");
    const afterContent = (state.afterFunction || "").trim();
    activateDir.file(`${afterName}.mcfunction`, (afterContent ? afterContent + "\n" : ""));

    // Pattern point files under patterns/<spellName>/{i}.mcfunction
    for(let i=0;i<state.points.length;i++){
      patternsDir.file(`${i}.mcfunction`, buildPointFile(i) + "\n");
    }

    const blob = await zip.generateAsync({type:'blob'});
    const zipName = `${state.spellName || 'Spell_Name'}.zip`;
    saveAs(blob, zipName);
    statusEl.textContent = "ZIP downloaded";
    setTimeout(()=>{ statusEl.textContent = ""; }, 1500);
  });

  $('#copyPreview')?.addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(previewEl?.textContent||''); statusEl.textContent='Preview copied'; setTimeout(()=>{statusEl.textContent='';},1200); }catch{}
  });

  // --- Builders ---
  function buildPointFile(i){
    const p = state.points[i];
    const lines=[];
    if(i===0){
      const sn=state.spellName||'<spellName>';
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.spell_name set value ${sn}`);
    }
    for(const cmd of (p.commands||[])){ if(cmd && cmd.trim()) lines.push(cmd.trim()); }
    if(i<state.points.length-1){
      lines.push(`$function spellcasting:spawn_spell_point {UUID:$(UUID),ox:${trimFloat(p.offset.x)},oy:${trimFloat(p.offset.y)},oz:${trimFloat(p.offset.z)}}`);
    } else {
      // EXACT final point block
      lines.push(`# Set Spell Delay // add option to change on website`);
      lines.push(`scoreboard players set @s spell_delay ${state.settings.delay}`);
      lines.push(``);
      lines.push(`# Set function to run after delay // add option to change on website // this is what happens after the spell is completed`);
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".loaded_spell set value ${state.settings.loadedSpell}`);
      lines.push(``);
      lines.push(`# Keep this exact formatting`);
      lines.push(`$kill @e[tag=spell_pos,nbt={data:{owner:$(UUID)}}]`);
      lines.push(`$kill @e[tag=spell_point,nbt={data:{owner:$(UUID)}}]`);
      lines.push(``);
      lines.push(`# This is the same`);
    }
    lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.next_func set value ${i+1}`);
    return lines.join('\n');
  }

  // Init
  renderPoints(); renderEditor(); renderPreview();

  // Utils
  function fmt(v){ return (Math.round((+v||0)*100)/100).toString(); }
  function trimFloat(v){ const n=+v; return Number.isInteger(n)? n : n.toFixed(2).replace(/\.00$/,''); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
  function round2(n){ return Math.round(n*100)/100; }
})();
