(function(){
  // ---------- State ----------
  const state = {
    spellName: '',
    settings: { delay: 50, loadedSpell: 'incendio' },
    afterFunction: '',
    // No default raycasts; user may add none
    rays: [],
    points: [ { commands: [], offset: {x:0,y:0,z:0} } ],
    selected: 0,
  };

  function mkRay(name){
    return {
      name,
      enabled: false,
      collapsed: false,
      step: 0.5,
      maxSteps: 40,
      particles: [
        { name:'small_flame', dx:0.1, dy:0.1, dz:0.1, speed:0, count:2 }
      ],
      blockChecks: [],
      // supports macros in selector/command (e.g. $(UUID))
      entityChecks: [],
    };
  }

  // ---------- DOM ----------
  const $ = (s)=>document.querySelector(s);
  const pointsListEl = $('#pointsList');
  const selectedLabelEl = $('#selectedLabel');
  const previewEl = $('#preview');
  const statusEl = $('#status');
  const commandsEl = $('#commands');          // <— commands list container

  const nameInput = $('#spellName');
  const offX = $('#offsetX');
  const offY = $('#offsetY');
  const offZ = $('#offsetZ');
  const spellDelayEl  = $('#spellDelay');
  const loadedSpellEl = $('#loadedSpell');
  const loadedSpellLabel = $('#loadedSpellLabel');
  const afterFunctionEl = $('#afterFunction');

  const addPointBtn = $('#addPointBtn');
  const addCmdBtn = $('#addCmdBtn');
  const clearPointBtn = $('#clearPointBtn');
  const deletePointBtn = $('#deletePointBtn');
  const resetOffsetBtn = $('#resetOffset');

  const raysContainer = $('#raysContainer');
  const addRayBtn = $('#addRayBtn');

  addRayBtn?.addEventListener('click', ()=>{
    state.rays.push(mkRay(`Cast ${state.rays.length+1}`));
    renderRays(); save();
  });

  [offX, offY, offZ].forEach(i=>{ if(i){ i.step='any'; i.inputMode='decimal'; } });

  // ---------- Grids ----------
  const grid = document.getElementById('gridCanvas');
  const thumb = document.getElementById('gridThumb');
  const overviewSvg = document.getElementById('overviewSvg');
  const CELLS=6, SIZE=180, CELL=SIZE/CELLS, RANGE=CELLS/2;

  // ---------- Storage ----------
  const save = ()=>{ try{ localStorage.setItem('spellcast_site_v2', JSON.stringify(state)); }catch{} };
  const load = ()=>{ try{
    const raw=localStorage.getItem('spellcast_site_v2'); if(!raw) return;
    const s=JSON.parse(raw);
    if(s){
      state.spellName = s.spellName || '';
      state.settings  = s.settings ? { delay: (+s.settings.delay||50), loadedSpell: s.settings.loadedSpell || 'incendio' } : state.settings;
      state.afterFunction = s.afterFunction || '';
      state.rays = Array.isArray(s.rays) ? s.rays.map(normalizeRay) : state.rays;
      state.points = Array.isArray(s.points) && s.points.length ? s.points.map(p=>({
        commands:(p.commands||[]).map(String),
        offset: p.offset? {x:+p.offset.x||0, y:+p.offset.y||0, z:+p.offset.z||0}:{x:0,y:0,z:0}
      })) : state.points;
      state.selected = Math.min(+s.selected||0, state.points.length-1);
    }
  }catch{} };
  function normalizeRay(r){
    return {
      name: r.name || `Cast`,
      enabled: !!r.enabled,
      collapsed: !!r.collapsed,
      step: +r.step || 0.5,
      maxSteps: Math.max(1, +r.maxSteps || 40),
      particles: Array.isArray(r.particles) ? r.particles.map(p=>({
        name: p.name || 'small_flame',
        dx: +p.dx || 0, dy:+p.dy || 0, dz:+p.dz || 0, speed:+p.speed || 0, count: Math.max(0, +p.count || 0)
      })) : [],
      blockChecks: Array.isArray(r.blockChecks) ? r.blockChecks.map(b=>({ id: b.id||'#air', cmd: (b.cmd||'').toString(), pass: !!b.pass })) : [],
      entityChecks: Array.isArray(r.entityChecks) ? r.entityChecks.map(e=>({ selector: (e.selector||'@e[distance=..0.6]').toString(), cmd: (e.cmd||'').toString(), pass: !!e.pass })) : [],
    };
  }
  load();

  // init text inputs
  if(nameInput) nameInput.value = state.spellName;
  if(spellDelayEl)  spellDelayEl.value  = state.settings.delay;
  if(loadedSpellEl) loadedSpellEl.value = state.settings.loadedSpell;
  if(loadedSpellLabel) loadedSpellLabel.textContent = state.settings.loadedSpell;
  if(afterFunctionEl) afterFunctionEl.value = state.afterFunction;

  // ---------- Renderers ----------
  function renderPoints(){
    if(!pointsListEl) return;
    pointsListEl.innerHTML='';
    state.points.forEach((p,i)=>{
      const el = document.createElement('div');
      el.className = 'point-item' + (i===state.selected?' active':'');
      el.innerHTML = `
        <div class="point-meta">
          <span class="badge">#${i}</span>
          <div class="muted">${p.commands.length} cmd${p.commands.length===1?'':'s'} · (${fmt(p.offset.x)}, ${fmt(p.offset.y)}, ${fmt(p.offset.z)})</div>
        </div>`;
      el.addEventListener('click', ()=>{ state.selected=i; rerender(); });
      pointsListEl.appendChild(el);
    });
  }

  function renderCommands(){
    if(!commandsEl) return;
    const p = state.points[state.selected];
    commandsEl.innerHTML = '';

    // rows for each command
    p.commands.forEach((cmd, i)=>{
      const row = document.createElement('div');
      row.className = 'cmd-row';
      row.innerHTML = `
        <textarea class="cmd-text" rows="1" placeholder="$data modify ...">${esc(cmd)}</textarea>
        <button class="btn small danger" title="Delete command">✕</button>
      `;
      const ta = row.querySelector('.cmd-text');
      const del = row.querySelector('button');

      // auto-grow textarea height
      const fit = ()=>{ ta.style.height='auto'; ta.style.height = (ta.scrollHeight)+'px'; };
      ta.addEventListener('input', ()=>{
        state.points[state.selected].commands[i] = ta.value;
        fit(); renderPreview(); save();
      });
      // initial set & grow
      fit();

      del.addEventListener('click', ()=>{
        state.points[state.selected].commands.splice(i,1);
        renderCommands(); renderPoints(); renderPreview(); save();
      });

      commandsEl.appendChild(row);
    });
  }

  function renderEditor(){
    if(selectedLabelEl) selectedLabelEl.textContent = `Point ${state.selected}`;
    const p = state.points[state.selected];
    if(offX) offX.value = p.offset.x;
    if(offY) offY.value = p.offset.y;
    if(offZ) offZ.value = p.offset.z;
    updateThumb();
    renderCommands();    // <— ensure the commands UI is refreshed
    renderOverview();
  }

  function renderPreview(){
    if(!previewEl) return;
    const i = state.selected;
    const p = state.points[i];
    const lines = [];

    if(i===0){
      const sn = state.spellName || '<spellName>';
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.spell_name set value ${sn}`);
    }
    for(const cmd of p.commands){ if(cmd && cmd.trim()) lines.push(cmd.trim()); }
    if(i < state.points.length - 1){
      lines.push(`$function spellcasting:spawn_spell_point {UUID:$(UUID),ox:${trimFloat(p.offset.x)},oy:${trimFloat(p.offset.y)},oz:${trimFloat(p.offset.z)}}`);
    } else {
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
    previewEl.textContent = lines.join('\n');

    updateThumb();
    renderOverview();
  }

  function renderRays(){
    if(!raysContainer) return;
    raysContainer.innerHTML = '';
    state.rays.forEach((ray, idx)=>{
      const rayEl = document.createElement('div');
      rayEl.className = 'ray';

      const head = document.createElement('div');
      head.className = 'ray-head';
      head.innerHTML = `
        <div class="title">${ray.name}</div>
        <div class="controls">
          <label class="muted tiny" style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" ${ray.enabled?'checked':''} data-act="toggle" /> Enabled
          </label>
          <span class="muted tiny">Step</span>
          <input type="number" class="step" value="${ray.step}" step="any" style="width:84px">
          <span class="muted tiny">Max Steps</span>
          <input type="number" class="max" value="${ray.maxSteps}" step="1" min="1" style="width:84px">
          <button class="btn small" data-act="collapse">${ray.collapsed?'▾ Expand':'▴ Collapse'}</button>
          <button class="btn small danger" data-act="del">Delete</button>
        </div>
      `;
      rayEl.appendChild(head);

      const body = document.createElement('div');
      body.className = 'ray-body';
      body.style.display = ray.collapsed? 'none':'grid';

      const grid = document.createElement('div');
      grid.className = 'ray-grid';

      const checksCol = document.createElement('div');
      checksCol.appendChild(groupBlocks(ray, idx));
      checksCol.appendChild(groupEntities(ray, idx));

      const particlesCol = document.createElement('div');
      particlesCol.appendChild(groupParticles(ray, idx));

      grid.appendChild(checksCol);
      grid.appendChild(particlesCol);
      body.appendChild(grid);
      rayEl.appendChild(body);

      head.querySelector('[data-act="toggle"]')?.addEventListener('change', e=>{
        state.rays[idx].enabled = !!e.target.checked; save();
      });
      head.querySelector('.step')?.addEventListener('input', e=>{
        state.rays[idx].step = parseFloat(e.target.value)||0.5; save();
      });
      head.querySelector('.max')?.addEventListener('input', e=>{
        state.rays[idx].maxSteps = Math.max(1, parseInt(e.target.value,10)||40); save();
      });
      head.querySelector('[data-act="collapse"]')?.addEventListener('click', ()=>{
        state.rays[idx].collapsed = !state.rays[idx].collapsed;
        renderRays(); save();
      });
      head.querySelector('[data-act="del"]')?.addEventListener('click', ()=>{
        state.rays.splice(idx,1); renderRays(); save();
      });

      raysContainer.appendChild(rayEl);
    });
  }

  function groupBlocks(ray, idx){
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `
      <div class="group-title">
        <div class="label">Block Checks</div>
        <button class="btn small success" data-act="add">+</button>
      </div>
      <div class="group-items"></div>
    `;
    const items = wrap.querySelector('.group-items');
    function render(){
      items.innerHTML='';
      ray.blockChecks.forEach((b,i)=>{
        const row = document.createElement('div');
        row.className='rule';
        row.innerHTML = `
          <div class="key">ID:</div>
          <input type="text" value="${esc(b.id)}" placeholder="minecraft:dirt or #air" style="width:260px">
          <button class="btn small del">✕</button>
          <div class="key">Command:</div>
          <input type="text" value="${esc(b.cmd)}" placeholder="say hello world" style="width:360px">
          <label class="pass"><input type="checkbox" ${b.pass?'checked':''}> Pass through</label>
        `;
        const [ , idInput, delBtn, , cmdInput, passLbl ] = row.children;
        idInput.addEventListener('input',e=>{ state.rays[idx].blockChecks[i].id = e.target.value; save(); });
        cmdInput.addEventListener('input',e=>{ state.rays[idx].blockChecks[i].cmd = e.target.value; save(); });
        passLbl.querySelector('input').addEventListener('change',e=>{ state.rays[idx].blockChecks[i].pass = !!e.target.checked; save(); });
        delBtn.addEventListener('click', ()=>{ state.rays[idx].blockChecks.splice(i,1); render(); save(); });
        items.appendChild(row);
      });
    }
    wrap.querySelector('[data-act="add"]')?.addEventListener('click', ()=>{
      state.rays[idx].blockChecks.push({id:'#air', cmd:'', pass:false}); render(); save();
    });
    render();
    return wrap;
  }

  function groupEntities(ray, idx){
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `
      <div class="group-title">
        <div class="label">Entity Checks</div>
        <button class="btn small success" data-act="add">+</button>
      </div>
      <div class="group-items"></div>
    `;
    const items = wrap.querySelector('.group-items');
    function render(){
      items.innerHTML='';
      ray.entityChecks.forEach((eRule,i)=>{
        const row = document.createElement('div');
        row.className='rule';
        row.innerHTML = `
          <div class="key">Selector:</div>
          <input type="text" value="${esc(eRule.selector)}" placeholder='@e[type=cow,distance=..1]' style="width:320px">
          <button class="btn small del">✕</button>
          <div class="key">Command:</div>
          <input type="text" value="${esc(eRule.cmd)}" placeholder="say entity hit" style="width:360px">
          <label class="pass"><input type="checkbox" ${eRule.pass?'checked':''}> Pass through</label>
        `;
        const [ , selInput, delBtn, , cmdInput, passLbl ] = row.children;
        selInput.addEventListener('input',e=>{ state.rays[idx].entityChecks[i].selector = e.target.value; save(); });
        cmdInput.addEventListener('input',e=>{ state.rays[idx].entityChecks[i].cmd = e.target.value; save(); });
        passLbl.querySelector('input').addEventListener('change',e=>{ state.rays[idx].entityChecks[i].pass = !!e.target.checked; save(); });
        delBtn.addEventListener('click', ()=>{ state.rays[idx].entityChecks.splice(i,1); render(); save(); });
        items.appendChild(row);
      });
    }
    wrap.querySelector('[data-act="add"]')?.addEventListener('click', ()=>{
      state.rays[idx].entityChecks.push({selector:'@e[distance=..0.6]', cmd:'', pass:false}); render(); save();
    });
    render();
    return wrap;
  }

  function groupParticles(ray, idx){
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.innerHTML = `
      <div class="group-title">
        <div class="label">Particles</div>
        <button class="btn small success" data-act="add">+</button>
      </div>
      <div class="particles-col"></div>
    `;
    const list = wrap.querySelector('.particles-col');
    function render(){
      list.innerHTML='';
      ray.particles.forEach((p,i)=>{
        const row=document.createElement('div');
        row.className='particle-row';
        row.innerHTML=`
          <input type="text" value="${esc(p.name)}" placeholder="small_flame">
          <input type="number" step="any" value="${p.dx}">
          <input type="number" step="any" value="${p.dy}">
          <input type="number" step="any" value="${p.dz}">
          <input type="number" step="any" value="${p.speed}">
          <input type="number" step="1" value="${p.count}">
          <button class="btn small del">✕</button>
        `;
        const [name,dx,dy,dz,speed,count,del] = row.children;
        name.addEventListener('input',e=>{ p.name=e.target.value; save(); });
        dx.addEventListener('input',e=>{ p.dx=parseFloat(e.target.value)||0; save(); });
        dy.addEventListener('input',e=>{ p.dy=parseFloat(e.target.value)||0; save(); });
        dz.addEventListener('input',e=>{ p.dz=parseFloat(e.target.value)||0; save(); });
        speed.addEventListener('input',e=>{ p.speed=parseFloat(e.target.value)||0; save(); });
        count.addEventListener('input',e=>{ p.count=parseInt(e.target.value,10)||0; save(); });
        del.addEventListener('click',()=>{ state.rays[idx].particles.splice(i,1); render(); save(); });
        list.appendChild(row);
      });
    }
    wrap.querySelector('[data-act="add"]')?.addEventListener('click', ()=>{
      state.rays[idx].particles.push({name:'small_flame',dx:0.1,dy:0.1,dz:0.1,speed:0,count:2});
      render(); save();
    });
    render();
    return wrap;
  }

  function rerender(){ renderPoints(); renderEditor(); renderPreview(); renderRays(); save(); }

  // ---------- XY grid ----------
  function clientToXY(evt){
    const r = grid.getBoundingClientRect();
    const xpx = Math.min(Math.max(0,(evt.clientX??evt.touches?.[0]?.clientX)-r.left), SIZE);
    const ypx = Math.min(Math.max(0,(evt.clientY??evt.touches?.[0]?.clientY)-r.top), SIZE);
    const x = (xpx - SIZE/2) / CELL;
    const y = (SIZE/2 - ypx) / CELL;
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
    if(offX) offX.value = p.offset.x; if(offY) offY.value = p.offset.y;
    renderPreview(); save();
  }
  if(grid){
    let dragging=false;
    grid.addEventListener('pointerdown', e=>{ dragging=true; try{grid.setPointerCapture(e.pointerId);}catch{} setXYFromGrid(e); });
    grid.addEventListener('pointermove', e=>{ if(dragging) setXYFromGrid(e); });
    grid.addEventListener('pointerup',   e=>{ dragging=false; try{grid.releasePointerCapture(e.pointerId);}catch{} });
    grid.addEventListener('pointerleave',()=>{ dragging=false; });
  }

  // ---------- Overview path (path preview) ----------
  function renderOverview(){
    if(!overviewSvg) return;
    const pts = state.points.map(p=>({ x: (p.offset.x*CELL)+SIZE/2, y: SIZE/2 - (p.offset.y*CELL) }));
    overviewSvg.innerHTML='';
    // grid background (optional guide)
    // draw lines between points
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const line=document.createElementNS('http://www.w3.org/200/svg','line'); // typo-proof
    }
    // recreate properly
    overviewSvg.innerHTML = '';
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
      line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
      line.setAttribute('stroke','#38bdf8'); line.setAttribute('stroke-width','2'); line.setAttribute('stroke-linecap','round');
      overviewSvg.appendChild(line);
    }
    // points
    pts.forEach((p,idx)=>{
      const g=document.createElementNS('http://www.w3.org/2000/svg','g');
      const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx',p.x); c.setAttribute('cy',p.y); c.setAttribute('r','7'); c.setAttribute('fill', idx===state.selected ? '#22d3ee' : '#38bdf8'); c.setAttribute('opacity', '0.95');
      const t=document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x',p.x); t.setAttribute('y',p.y+3); t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','9'); t.setAttribute('font-weight','700'); t.setAttribute('fill','#0b1020'); t.textContent=idx;
      g.appendChild(c); g.appendChild(t); overviewSvg.appendChild(g);
    });
  }

  // ---------- Buttons & inputs ----------
  addPointBtn?.addEventListener('click', ()=>{
    state.points.push({ commands: [], offset: {x:0,y:0,z:0} });
    state.selected = state.points.length - 1;
    rerender();
  });

  addCmdBtn?.addEventListener('click', ()=>{
    state.points[state.selected].commands.push('');
    renderCommands(); renderPreview(); renderPoints(); save();
  });

  clearPointBtn?.addEventListener('click', ()=>{
    const idx = state.selected;
    if (idx < 0 || idx >= state.points.length) return;
    state.points[idx].commands = [];
    renderCommands(); renderPreview(); renderPoints(); updateThumb(); save();
  });

  deletePointBtn?.addEventListener('click', ()=>{
    if (state.points.length === 0) return;
    const delIdx = state.selected;
    state.points.splice(delIdx, 1);
    if (state.points.length === 0) {
      state.points.push({ commands: [], offset: { x: 0, y: 0, z: 0 } });
    }
    state.selected = Math.min(Math.max(0, delIdx - 1), state.points.length - 1);
    const p = state.points[state.selected];
    if (offX) offX.value = p.offset.x;
    if (offY) offY.value = p.offset.y;
    if (offZ) offZ.value = p.offset.z;
    renderPoints(); renderEditor(); renderPreview(); updateThumb(); save();
  });

  resetOffsetBtn?.addEventListener('click', ()=>{
    const p = state.points[state.selected];
    p.offset = {x:0,y:0,z:0};
    if(offX) offX.value = 0;
    if(offY) offY.value = 0;
    if(offZ) offZ.value = 0;
    updateThumb(); renderPreview(); renderPoints(); renderOverview(); save();
  });

  nameInput?.addEventListener('input', ()=>{
    state.spellName = nameInput.value.trim();
    renderPreview(); save();
  });
  offX?.addEventListener('input', ()=>{
    const v = parseFloat(offX.value);
    if(Number.isFinite(v)){
      state.points[state.selected].offset.x = v;
      updateThumb(); renderPreview(); renderOverview(); renderPoints(); save();
    }
  });
  offY?.addEventListener('input', ()=>{
    const v = parseFloat(offY.value);
    if(Number.isFinite(v)){
      state.points[state.selected].offset.y = v;
      updateThumb(); renderPreview(); renderOverview(); renderPoints(); save();
    }
  });
  offZ?.addEventListener('input', ()=>{
    const v = parseFloat(offZ.value);
    if(Number.isFinite(v)){
      state.points[state.selected].offset.z = v;
      renderPreview(); save();
    }
  });

  // ---------- Export / Import ----------
  $('#exportJson')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    saveAs(blob,`${safeName(state.spellName)||'spell'}.json`);
  });
  $('#importJson')?.addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const s=JSON.parse(r.result);
        if(!s || !Array.isArray(s.points)) return alert('Invalid JSON file');
        Object.assign(state, {
          spellName: s.spellName||'',
          settings: s.settings ? { delay: (+s.settings.delay||50), loadedSpell: s.settings.loadedSpell || 'incendio' } : state.settings,
          afterFunction: s.afterFunction || '',
          rays: Array.isArray(s.rays) ? s.rays.map(normalizeRay) : state.rays,
          points: s.points.map(p=>({commands:(p.commands||[]).map(String), offset:p.offset?{x:+p.offset.x||0,y:+p.offset.y||0,z:+p.offset.z||0}:{x:0,y:0,z:0}})),
          selected: 0
        });
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

  // ---------- ZIP Export ----------
  $('#exportZip')?.addEventListener('click',async()=>{
    if(!state.spellName){ alert('Enter a spell name first'); return; }

    const zip = new JSZip();

    // pack.mcmeta (exact content)
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

    // structure
    const base = "data/spellcasting/function/spells/";
    const activateDir = zip.folder(base + "activate");
    const patternsDir = zip.folder(base + "patterns/" + (state.spellName || "spell"));
    const rayBase = base + (state.spellName || "spell") + "/";

    // activate content
    const loaded = (state.settings.loadedSpell || "incendio").replace(/[^a-zA-Z0-9_\-]/g,'_');
    const actLines = [];
    state.rays.forEach((ray, i)=>{
      if(!ray.enabled) return;
      const hasMacros = rayHasMacros(ray);
      actLines.push(`# ${ray.name}`);
      actLines.push(`scoreboard players set @s spell_ray_steps ${Math.max(1, ray.maxSteps)}`);
      if(hasMacros){
        actLines.push(`execute at @s anchored eyes run function spellcasting:spells/${(state.spellName||'spell')}/ray_tick_${i} with entity @s`);
      }else{
        actLines.push(`execute at @s anchored eyes run function spellcasting:spells/${(state.spellName||'spell')}/ray_tick_${i}`);
      }
      actLines.push('');
    });
    const after = (state.afterFunction||'').trim();
    if(after) actLines.push(after);
    activateDir.file(`${loaded}.mcfunction`, actLines.join("\n") + (actLines.length? "\n" : ""));

    // pattern point files
    for(let i=0;i<state.points.length;i++){
      patternsDir.file(`${i}.mcfunction`, buildPointFile(i) + "\n");
    }

    // rays
    const rayFolder = zip.folder(rayBase);
    state.rays.forEach((ray, i)=>{
      if(!ray.enabled) return;
      rayFolder.file(`ray_tick_${i}.mcfunction`, buildRayFile(ray, i) + "\n");
    });

    const blob = await zip.generateAsync({type:'blob'});
    const zipName = `${state.spellName || 'Spell_Name'}.zip`;
    saveAs(blob, zipName);
    statusEl.textContent = "ZIP downloaded";
    setTimeout(()=>{ statusEl.textContent = ""; }, 1500);
  });

  // ---------- Builders ----------
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

  function buildRayFile(ray, idx){
    const out = [];
    const hasMacros = rayHasMacros(ray);
    const macroObj = hasMacros ? buildMacroObject(ray) : '';

    out.push(`# ${ray.name}`);
    out.push(`# Limiter (requires objective 'spell_ray_steps')`);
    // your latest rule: return fail when out of steps
    out.push(`execute if score @s spell_ray_steps matches ..0 run return fail`);
    out.push(`scoreboard players remove @s spell_ray_steps 1`);
    out.push(``);

    // particles
    ray.particles.forEach(p=>{
      out.push(`particle ${p.name||'small_flame'} ^ ^ ^ ${num(p.dx)} ${num(p.dy)} ${num(p.dz)} ${num(p.speed)} ${Math.max(0,Math.floor(p.count||0))}`);
    });

    // block checks
    ray.blockChecks.forEach(b=>{
      if(!b.id || !b.cmd) return;
      if(b.pass){
        out.push(`execute unless block ^ ^ ^ ${b.id} run ${b.cmd}`);
      }else{
        // keep your syntax: "run return ${cmd}"
        out.push(`execute unless block ^ ^ ^ ${b.id} run return ${b.cmd}`);
      }
    });

    // entity checks (macro-aware prefix)
    ray.entityChecks.forEach(e=>{
      if(!e.selector || !e.cmd) return;
      const base = e.pass
        ? `execute if entity ${e.selector} run ${e.cmd}`
        : `execute if entity ${e.selector} run return ${e.cmd}`;
      if(containsMacro(base)){
        out.push(`$${base}`);
      }else{
        out.push(base);
      }
    });

    // step forward (macro-aware recursive call)
    const step = `execute positioned ^ ^ ^${num(ray.step)} run function spellcasting:spells/${(state.spellName||'spell')}/ray_tick_${idx}`;
    if(hasMacros){
      out.push(`$${step} ${macroObj}`);
    }else{
      out.push(step);
    }
    return out.join('\n');
  }

  // ---------- Macro helpers ----------
  function containsMacro(s){
    return /\$\([A-Za-z0-9_]+\)/.test(String(s||''));
  }
  function extractMacroNamesFromRay(ray){
    const names = new Set();
    (ray.entityChecks||[]).forEach(e=>{
      const scan = (txt)=>{
        String(txt||'').replace(/\$\(([A-Za-z0-9_]+)\)/g, (_,name)=>{ names.add(name); return ''; });
      };
      scan(e.selector);
      scan(e.cmd);
    });
    return Array.from(names);
  }
  function rayHasMacros(ray){
    return extractMacroNamesFromRay(ray).length > 0;
  }
  function buildMacroObject(ray){
    const names = extractMacroNamesFromRay(ray);
    if(!names.length) return '';
    const pairs = names.map(n=>`${n}:$(${n})`);
    return `{${pairs.join(',')}}`;
  }

  // ---------- Init ----------
  renderPoints(); renderEditor(); renderPreview(); renderRays();

  // ---------- Utils ----------
  function fmt(v){ return (Math.round((+v||0)*100)/100).toString(); }
  function trimFloat(v){ const n=+v; return Number.isInteger(n)? n : n.toFixed(2).replace(/\.00$/,''); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
  function round2(n){ return Math.round(n*100)/100; }
  function safeName(s){ return (s||'').toLowerCase().replace(/[^a-z0-9-_]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''); }
  function num(n){ const x=+n; return Number.isFinite(x) ? (Number.isInteger(x)? x : x.toFixed(2).replace(/\.00$/,'')) : 0; }
  function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
})();
