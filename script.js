(function(){
  // ---------- State (matches your new C# structure) ----------
  const state = {
    spellName: '',
    author: '',
    spellDelay: 50,
    points: [ mkPoint() ],
    selected: 0,
    finishCommands: [],
    raycasts: [], // { name, step, max_distance, commands[], block_checks[], entity_checks[], collapsed, enabled }
  };

  function mkPoint(){ return { commands: [], offset: { x:0, y:0, z:0 } }; }
  function mkRay(name){
    return {
      name: name || `Ray ${state.raycasts.length+1}`,
      step: 0.5,
      max_distance: 50,
      commands: [],
      block_checks: [], // [{id, cmd, pass, invert}]
      entity_checks: [], // [{selector, cmd, pass, invert}]
      collapsed: false,
      enabled: true
    };
  }

  // ---------- DOM ----------
  const $ = s => document.querySelector(s);
  const pointsListEl = $('#pointsList');
  const selectedLabelEl = $('#selectedLabel');
  const commandsEl = $('#commands');
  const previewEl = $('#preview');
  const overviewSvg = $('#overviewSvg');
  const statusEl = $('#status');

  const spellNameEl = $('#spellName');
  const authorEl = $('#author');
  const spellDelayEl = $('#spellDelay');

  const offX = $('#offsetX'), offY = $('#offsetY'), offZ = $('#offsetZ');
  const addPointBtn = $('#addPointBtn'), deletePointBtn = $('#deletePointBtn'), clearPointBtn = $('#clearPointBtn');
  const addCmdBtn = $('#addCmdBtn'), resetOffsetBtn = $('#resetOffset');

  const grid = document.getElementById('gridCanvas');
  const thumb = document.getElementById('gridThumb');
  const CELLS=3, SIZE=180, CELL=SIZE/CELLS, RANGE=CELLS/2; // 3×3

  const afterFunctionEl = $('#afterFunction');

  const raysContainer = $('#raysContainer');
  const addRayBtn = $('#addRayBtn');

  // ---------- Storage ----------
  function save(){ try{ localStorage.setItem('spellcast_site_v3', JSON.stringify(state)); }catch{} }
  function load(){ try{
    const raw=localStorage.getItem('spellcast_site_v3'); if(!raw) return;
    const s=JSON.parse(raw)||{};
    state.spellName=s.spellName||''; state.author=s.author||''; state.spellDelay=+s.spellDelay||50;
    state.points=Array.isArray(s.points)&&s.points.length? s.points.map(normPoint):[mkPoint()];
    state.selected=Math.min(+s.selected||0, state.points.length-1);
    state.finishCommands=Array.isArray(s.finishCommands)? s.finishCommands.map(String):[];
    state.raycasts=Array.isArray(s.raycasts)? s.raycasts.map(normRay):[];
  }catch{} }
  load();

  // ---------- Init inputs ----------
  spellNameEl.value = state.spellName || '';
  authorEl.value = state.author || '';
  spellDelayEl.value = state.spellDelay;
  afterFunctionEl.value = (state.finishCommands||[]).join('\n');

  // ---------- Renderers ----------
  function renderPoints(){
    pointsListEl.innerHTML = '';
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
    const p = state.points[state.selected];
    commandsEl.innerHTML = '';
    p.commands.forEach((cmd, idx)=>{
      const row = document.createElement('div');
      row.className = 'cmd-row';
      row.innerHTML = `
        <textarea class="cmd-text" rows="1" spellcheck="false" placeholder="$data modify ...">${esc(cmd)}</textarea>
        <button class="btn small danger">✕</button>`;
      const ta = row.querySelector('textarea');
      const del = row.querySelector('button');
      const fit = ()=>{ ta.style.height='auto'; ta.style.height = ta.scrollHeight+'px'; };
      ta.addEventListener('input', ()=>{
        state.points[state.selected].commands[idx] = ta.value;
        fit(); renderPreview(); save();
      });
      fit();
      del.addEventListener('click', ()=>{
        state.points[state.selected].commands.splice(idx,1);
        renderCommands(); renderPoints(); renderPreview(); save();
      });
      commandsEl.appendChild(row);
    });
  }

  function renderEditor(){
    selectedLabelEl.textContent = `Point ${state.selected}`;
    const p = state.points[state.selected];
    offX.value = p.offset.x; offY.value = p.offset.y; offZ.value = p.offset.z;
    drawGrid(); updateThumb(); renderCommands(); renderOverview(); renderPreview();
  }

  function renderPreview(){
    const i = state.selected;
    const p = state.points[i];
    const lines = [];

    if(i===0){
      // ensure first command sets spell name storage
      const sn = state.spellName || '<spellName>';
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.spell_name set value ${sn}`);
    }
    (p.commands||[]).forEach(cmd=>{
      if(cmd && cmd.trim()) lines.push(cmd.trim());
    });

    if(i < state.points.length - 1){
      lines.push(`$function spellcasting:spawn_spell_point {UUID:$(UUID),ox:${trim(p.offset.x)},oy:${trim(p.offset.y)},oz:${trim(p.offset.z)}}`);
    }else{
      // final footer per new C#
      lines.push(`$kill @e[tag=spell_pos,nbt={data:{owner:$(UUID)}}]`);
      lines.push(`$kill @e[tag=spell_point,nbt={data:{owner:$(UUID)}}]`);
      lines.push(`scoreboard players set @s spell_delay ${state.spellDelay}`);
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".loaded_spell set value ${safeName(state.spellName)||'spell'}`);
    }
    lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.next_func set value ${i+1}`);

    previewEl.textContent = lines.join('\n');
  }

  function renderRays(){
    raysContainer.innerHTML = '';
    state.raycasts.forEach((ray, idx)=>{
      const card = document.createElement('div');
      card.className = 'ray';

      const head = document.createElement('div');
      head.className = 'ray-head';
      head.innerHTML = `
        <div class="title">${ray.name}</div>
        <div class="controls">
          <span class="muted tiny">Step</span>
          <input type="number" class="step" value="${ray.step}" step="any" style="width:80px">
          <span class="muted tiny">Max Steps</span>
          <input type="number" class="max" value="${ray.max_distance}" step="1" min="1" style="width:80px">
          <button class="btn small" data-act="collapse">${ray.collapsed?'▾ Expand':'▴ Collapse'}</button>
          <button class="btn small danger" data-act="del">Delete</button>
        </div>`;
      card.appendChild(head);

      const body = document.createElement('div');
      body.className = 'ray-body';
      body.style.display = ray.collapsed ? 'none' : 'block';
      body.innerHTML = `
        <div class="group">
          <div class="group-title">
            <div class="label">Ray Commands</div>
            <button class="btn small success" data-add-cmd>+</button>
          </div>
          <div class="group-items cmds"></div>
        </div>

        <div class="ray-grid">
          <div class="group">
            <div class="group-title">
              <div class="label">Block Checks</div>
              <button class="btn small success" data-add-block>+</button>
            </div>
            <div class="group-items blocks"></div>
          </div>

          <div class="group">
            <div class="group-title">
              <div class="label">Entity Checks</div>
              <button class="btn small success" data-add-entity>+</button>
            </div>
            <div class="group-items ents"></div>
          </div>
        </div>
      `;
      card.appendChild(body);

      // head handlers
      head.querySelector('.step').addEventListener('input', e=>{
        ray.step = parseFloat(e.target.value)||0.5; save();
      });
      head.querySelector('.max').addEventListener('input', e=>{
        ray.max_distance = Math.max(1, parseInt(e.target.value,10)||50); save();
      });
      head.querySelector('[data-act="collapse"]').addEventListener('click', ()=>{
        ray.collapsed = !ray.collapsed; renderRays(); save();
      });
      head.querySelector('[data-act="del"]').addEventListener('click', ()=>{
        state.raycasts.splice(idx,1); renderRays(); save();
      });

      // commands
      const cmdsWrap = body.querySelector('.cmds');
      function renderCmds(){
        cmdsWrap.innerHTML = '';
        ray.commands.forEach((c,i)=>{
          const row = document.createElement('div');
          row.className = 'cmd-row';
          row.innerHTML = `
            <textarea class="cmd-text" rows="1" spellcheck="false" placeholder="particle small_flame ^ ^ ^ 0 0 0 0 1">${esc(c)}</textarea>
            <button class="btn small danger">✕</button>`;
          const ta = row.querySelector('textarea'), del = row.querySelector('button');
          const fit = ()=>{ ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px'; };
          ta.addEventListener('input', ()=>{ ray.commands[i]=ta.value; fit(); save(); });
          fit();
          del.addEventListener('click', ()=>{ ray.commands.splice(i,1); renderCmds(); save(); });
          cmdsWrap.appendChild(row);
        });
      }
      body.querySelector('[data-add-cmd]').addEventListener('click', ()=>{
        ray.commands.push(''); renderCmds(); save();
      });
      renderCmds();

      // block checks
      const blocksWrap = body.querySelector('.blocks');
      function renderBlocks(){
        blocksWrap.innerHTML='';
        ray.block_checks.forEach((b,i)=>{
          const row = document.createElement('div'); row.className='rule';
          row.innerHTML = `
            <div class="key">ID:</div>
            <input type="text" value="${esc(b.id)}" placeholder="minecraft:stone or #air">
            <button class="btn small del">✕</button>
            <div class="key">Command:</div>
            <input type="text" value="${esc(b.cmd)}" placeholder="say block hit">
            <label class="pass"><input type="checkbox" ${b.pass?'checked':''}> Pass through</label>
            <label class="invert"><input type="checkbox" ${b.invert?'checked':''}> Inverted</label>`;
          const [ , idI, del, , cmdI, passLbl ] = row.children;
          idI.addEventListener('input', e=>{ b.id=e.target.value; save(); });
          cmdI.addEventListener('input', e=>{ b.cmd=e.target.value; save(); });
          passLbl.querySelector('input').addEventListener('change', e=>{ b.pass=!!e.target.checked; save(); });
          row.querySelector('.invert input').addEventListener('change', e=>{ b.invert=!!e.target.checked; save(); });
          del.addEventListener('click', ()=>{ ray.block_checks.splice(i,1); renderBlocks(); save(); });
          blocksWrap.appendChild(row);
        });
      }
      body.querySelector('[data-add-block]').addEventListener('click', ()=>{
        ray.block_checks.push({id:'#air', cmd:'', pass:false, invert:false}); renderBlocks(); save();
      });
      renderBlocks();

      // entity checks
      const entsWrap = body.querySelector('.ents');
      function renderEnts(){
        entsWrap.innerHTML='';
        ray.entity_checks.forEach((e,i)=>{
          const row = document.createElement('div'); row.className='rule';
          row.innerHTML = `
            <div class="key">Selector:</div>
            <input type="text" value="${esc(e.selector)}" placeholder='@e[type=cow,distance=..0.6]'>
            <button class="btn small del">✕</button>
            <div class="key">Command:</div>
            <input type="text" value="${esc(e.cmd)}" placeholder='say entity'>
            <label class="pass"><input type="checkbox" ${e.pass?'checked':''}> Pass through</label>
            <label class="invert"><input type="checkbox" ${e.invert?'checked':''}> Inverted</label>`;
          const [ , selI, del, , cmdI, passLbl ] = row.children;
          selI.addEventListener('input', ev=>{ e.selector=ev.target.value; save(); });
          cmdI.addEventListener('input', ev=>{ e.cmd=ev.target.value; save(); });
          passLbl.querySelector('input').addEventListener('change', ev=>{ e.pass=!!ev.target.checked; save(); });
          row.querySelector('.invert input').addEventListener('change', ev=>{ e.invert=!!ev.target.checked; save(); });
          del.addEventListener('click', ()=>{ ray.entity_checks.splice(i,1); renderEnts(); save(); });
          entsWrap.appendChild(row);
        });
      }
      body.querySelector('[data-add-entity]').addEventListener('click', ()=>{
        ray.entity_checks.push({selector:'@e[distance=..0.6]', cmd:'', pass:false, invert:false}); renderEnts(); save();
      });
      renderEnts();

      raysContainer.appendChild(card);
    });
  }

  function renderOverview(){
    overviewSvg.innerHTML='';
    const pts = state.points.map(p=>({ x:(p.offset.x*CELL)+SIZE/2, y:SIZE/2-(p.offset.y*CELL) }));
    for(let i=0;i<pts.length-1;i++){
      addLine(pts[i], pts[i+1], '#38bdf8', 2);
    }
    pts.forEach((p,idx)=>{
      const g=svgEl('g'), c=svgEl('circle'), t=svgEl('text');
      c.setAttribute('cx',p.x); c.setAttribute('cy',p.y); c.setAttribute('r','7');
      c.setAttribute('fill', idx===state.selected ? '#22d3ee' : '#38bdf8'); c.setAttribute('opacity','0.95');
      t.setAttribute('x',p.x); t.setAttribute('y',p.y+3); t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size','9'); t.setAttribute('font-weight','700'); t.setAttribute('fill','#0b1020'); t.textContent=idx;
      g.appendChild(c); g.appendChild(t); overviewSvg.appendChild(g);
    });
    function addLine(a,b,stroke,w){
      const l=svgEl('line'); l.setAttribute('x1',a.x); l.setAttribute('y1',a.y); l.setAttribute('x2',b.x); l.setAttribute('y2',b.y);
      l.setAttribute('stroke',stroke); l.setAttribute('stroke-width',w); l.setAttribute('stroke-linecap','round'); overviewSvg.appendChild(l);
    }
  }

  function rerender(){ renderPoints(); renderEditor(); renderRays(); save(); }

  // ---------- Grid + thumb ----------
  function drawGrid(){
    const ctx = grid.getContext('2d');
    ctx.clearRect(0,0,SIZE,SIZE);
    ctx.strokeStyle = '#243255';
    ctx.lineWidth = 1;
    for(let i=0;i<=CELLS;i++){
      const p=i*CELL+.5;
      ctx.beginPath(); ctx.moveTo(0,p); ctx.lineTo(SIZE,p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p,0); ctx.lineTo(p,SIZE); ctx.stroke();
    }
    // axes
    ctx.strokeStyle = '#355a8c'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(SIZE/2,0); ctx.lineTo(SIZE/2,SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,SIZE/2); ctx.lineTo(SIZE,SIZE/2); ctx.stroke();
  }
  function updateThumb(){
    const p = state.points[state.selected];
    const xpx = (p.offset.x * CELL) + SIZE/2;
    const ypx = SIZE/2 - (p.offset.y * CELL);
    thumb.style.left = xpx+'px'; thumb.style.top = ypx+'px';
  }
  function clientToXY(evt){
    const r=grid.getBoundingClientRect();
    const xpx=Math.min(Math.max(0,(evt.clientX??evt.touches?.[0]?.clientX)-r.left),SIZE);
    const ypx=Math.min(Math.max(0,(evt.clientY??evt.touches?.[0]?.clientY)-r.top),SIZE);
    const x=(xpx-SIZE/2)/CELL, y=(SIZE/2-ypx)/CELL;
    return { x: clamp(x,-RANGE,RANGE), y: clamp(y,-RANGE,RANGE) };
  }
  function setXYFromGrid(evt){
    const {x,y}=clientToXY(evt);
    const p=state.points[state.selected]; p.offset.x=round2(x); p.offset.y=round2(y);
    offX.value=p.offset.x; offY.value=p.offset.y; updateThumb(); renderOverview(); renderPreview(); save();
  }
  let dragging=false;
  grid.addEventListener('pointerdown',e=>{ dragging=true; try{grid.setPointerCapture(e.pointerId);}catch{} setXYFromGrid(e);});
  grid.addEventListener('pointermove',e=>{ if(dragging) setXYFromGrid(e); });
  grid.addEventListener('pointerup',e=>{ dragging=false; try{grid.releasePointerCapture(e.pointerId);}catch{} });
  grid.addEventListener('pointerleave',()=>{ dragging=false; });

  // ---------- Inputs ----------
  spellNameEl.addEventListener('input', ()=>{ state.spellName = spellNameEl.value.trim(); renderPreview(); save(); });
  authorEl.addEventListener('input', ()=>{ state.author = authorEl.value.trim(); save(); });
  spellDelayEl.addEventListener('input', ()=>{ const v=parseInt(spellDelayEl.value,10); if(Number.isFinite(v)) state.spellDelay=v; renderPreview(); save(); });

  offX.addEventListener('input', ()=>{ const v=parseFloat(offX.value); if(Number.isFinite(v)){ state.points[state.selected].offset.x=v; updateThumb(); renderOverview(); renderPreview(); save(); }});
  offY.addEventListener('input', ()=>{ const v=parseFloat(offY.value); if(Number.isFinite(v)){ state.points[state.selected].offset.y=v; updateThumb(); renderOverview(); renderPreview(); save(); }});
  offZ.addEventListener('input', ()=>{ const v=parseFloat(offZ.value); if(Number.isFinite(v)){ state.points[state.selected].offset.z=v; renderPreview(); save(); }});

  addPointBtn.addEventListener('click', ()=>{ state.points.push(mkPoint()); state.selected=state.points.length-1; rerender(); });
  deletePointBtn.addEventListener('click', ()=>{
    if(!state.points.length) return;
    const del = state.selected;
    state.points.splice(del,1);
    if(!state.points.length){ state.points.push(mkPoint()); }
    state.selected = Math.min(state.points.length-1, Math.max(0, del-1));
    rerender();
  });
  clearPointBtn.addEventListener('click', ()=>{
    const p=state.points[state.selected]; p.commands=[]; renderCommands(); renderPreview(); save();
  });
  resetOffsetBtn.addEventListener('click', ()=>{
    const p=state.points[state.selected]; p.offset={x:0,y:0,z:0};
    offX.value=0; offY.value=0; offZ.value=0; updateThumb(); renderOverview(); renderPreview(); save();
  });

  addCmdBtn.addEventListener('click', ()=>{
    state.points[state.selected].commands.push('');
    renderCommands(); renderPreview(); save();
  });

  afterFunctionEl.addEventListener('input', ()=>{
    state.finishCommands = splitToLines(afterFunctionEl.value);
    save();
  });

  addRayBtn.addEventListener('click', ()=>{
    state.raycasts.push(mkRay());
    renderRays(); save();
  });

  // ---------- Export / Import ----------
  $('#exportJson').addEventListener('click', ()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    saveAs(blob, `${safeName(state.spellName)||'spell'}.json`);
  });
  $('#importJson').addEventListener('change', e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const s=JSON.parse(r.result);
        Object.assign(state,{
          spellName: s.spellName||'',
          author: s.author||'',
          spellDelay: +s.spellDelay||50,
          points: Array.isArray(s.points)&&s.points.length? s.points.map(normPoint):[mkPoint()],
          selected: Math.min(+s.selected||0, (s.points?.length||1)-1),
          finishCommands: Array.isArray(s.finishCommands)? s.finishCommands.map(String):[],
          raycasts: Array.isArray(s.raycasts)? s.raycasts.map(normRay):[]
        });
        spellNameEl.value=state.spellName; authorEl.value=state.author; spellDelayEl.value=state.spellDelay;
        afterFunctionEl.value=(state.finishCommands||[]).join('\n');
        rerender();
      }catch(err){ alert('Import failed: '+err.message); }
    };
    r.readAsText(f);
  });

  // ---------- ZIP Export ----------
  $('#exportZip').addEventListener('click', async()=>{
    if(!state.spellName){ alert('Enter a spell name'); return; }
    const spellId = safeName(state.spellName) || 'spell';

    const zip = new JSZip();

    // pack.mcmeta
    const pack = `{
  "pack": {
    "pack_format": 81,
    "description": "Spellcasting extension pack by ${escJson(state.author||'')}",
    "supported_formats": {
      "min_inclusive": 45,
      "max_inclusive": 81
    }
  }
}
`;
    zip.file('pack.mcmeta', pack);

    // dirs
    const base = 'data/spellcasting/function/spells/';
    const activateDir = zip.folder(base + 'activate');
    const spellDir = zip.folder(base + spellId);
    const patternsDir = zip.folder(base + 'patterns/' + spellId);

    // points
    for(let i=0;i<state.points.length;i++){
      const text = buildPointFile(i, spellId);
      patternsDir.file(`${i}.mcfunction`, text + '\n');
    }

    // rays
    state.raycasts.forEach((ray,i)=>{
      spellDir.file(`ray_tick_${i}.mcfunction`, buildRayFile(ray, i, spellId) + '\n');
    });

    // finish (activate/<spell>.mcfunction)
    const finish = buildFinishFile(spellId);
    activateDir.file(`${spellId}.mcfunction`, finish + '\n');

    const blob=await zip.generateAsync({type:'blob'});
    saveAs(blob, `${state.spellName}.zip`);
    statusEl.textContent='ZIP downloaded'; setTimeout(()=>statusEl.textContent='',1500);
  });

  // ---------- Builders ----------
  function buildPointFile(i, spellId){
    const p = state.points[i];
    const lines = [];

    if(i===0){
      const sn = state.spellName || '<spellName>';
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.spell_name set value ${sn}`);
    }
    (p.commands||[]).forEach(c=>{ if(c && c.trim()) lines.push(c.trim()); });

    if(i < state.points.length - 1){
      lines.push(`$function spellcasting:spawn_spell_point {UUID:$(UUID),ox:${trim(p.offset.x)},oy:${trim(p.offset.y)},oz:${trim(p.offset.z)}}`);
    } else {
      lines.push(`$kill @e[tag=spell_pos,nbt={data:{owner:$(UUID)}}]`);
      lines.push(`$kill @e[tag=spell_point,nbt={data:{owner:$(UUID)}}]`);
      lines.push(`scoreboard players set @s spell_delay ${state.spellDelay}`);
      lines.push(`$data modify storage spellcast:user_data "$(UUID)".loaded_spell set value ${spellId}`);
    }
    lines.push(`$data modify storage spellcast:user_data "$(UUID)".current_point.next_func set value ${i+1}`);
    return lines.join('\n');
  }

  function buildFinishFile(spellId){
    const out = [];
    (state.finishCommands||[]).forEach(line=>{
      if(!line.trim()) return;
      out.push(containsMacro(line) ? `$${line.trim()}` : line.trim());
    });
    state.raycasts.forEach((ray,i)=>{
      out.push(`scoreboard players set @s spell_ray_steps ${Math.max(1, ray.max_distance|0)}`);
      out.push(`execute at @s anchored eyes run function spellcasting:spells/${spellId}/ray_tick_${i} with entity @s`);
    });
    return out.join('\n');
  }

  function buildRayFile(ray, idx, spellId){
    const out = [];
    out.push(`# ${ray.name || `Ray ${idx+1}`}`);
    out.push(`execute if score @s spell_ray_steps matches ..0 run return fail`);
    out.push(`scoreboard players remove @s spell_ray_steps 1`);
    out.push(``);

    // free-form ray commands
    (ray.commands||[]).forEach(cmd=>{
      if(!cmd || !cmd.trim()) return;
      out.push(containsMacro(cmd) ? `$${cmd.trim()}` : cmd.trim());
    });

    // entity checks (supports invert -> unless)
    (ray.entity_checks||[]).forEach(e=>{
      if(!e.selector) return;
      const cond = e.invert ? 'unless' : 'if';
      const base = e.pass
        ? `execute ${cond} entity ${e.selector} run ${e.cmd||''}`.trim()
        : `execute ${cond} entity ${e.selector} run return ${e.cmd||'fail'}`.trim();
      out.push(containsMacro(base) ? `$${base}` : base);
    });

    // block checks (supports invert -> unless)
    (ray.block_checks||[]).forEach(b=>{
      if(!b.id) return;
      const cond = b.invert ? 'unless' : 'if';
      const base = b.pass
        ? `execute ${cond} block ^ ^ ^ ${b.id} run ${b.cmd||''}`.trim()
        : `execute ${cond} block ^ ^ ^ ${b.id} run return ${b.cmd||'fail'}`.trim();
      out.push(base);
    });

    // step forward
    const stepLine = `execute positioned ^ ^ ^${num(ray.step)} run function spellcasting:spells/${spellId}/ray_tick_${idx}`;
    if(rayHasMacros(ray)){
      out.push(`$${stepLine} ${buildMacroObjectFromRay(ray)}`);
    }else{
      out.push(stepLine);
    }
    return out.join('\n');
  }

  // ---------- Utils / macros / normalize ----------
  function splitToLines(txt){ return String(txt||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
  function fmt(v){ return (Math.round((+v||0)*100)/100).toString(); }
  function trim(n){ const x=+n; return Number.isInteger(x) ? x : x.toFixed(2).replace(/\.00$/,''); }
  function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
  function round2(n){ return Math.round(n*100)/100; }
  function num(n){ const x=+n; return Number.isFinite(x)?(Number.isInteger(x)?x:x.toFixed(2).replace(/\.00$/,'')):0; }
  function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
  function escJson(s){ return String(s??'').replace(/\\/g,'\\\\').replace(/"/g,'\\"'); }
  function safeName(s){ return (s||'').toLowerCase().replace(/[^a-z0-9_-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''); }
  function svgEl(n){ return document.createElementNS('http://www.w3.org/2000/svg', n); }

  function containsMacro(s){ return /\$\([A-Za-z0-9_]+\)/.test(String(s||'')); }
  function rayHasMacros(ray){
    const lines = [
      ...(ray.commands||[]),
      ...(ray.entity_checks||[]).flatMap(e=>[e.selector||'', e.cmd||'']),
      ...(ray.block_checks||[]).map(b=>b.cmd||'')
    ].join('\n');
    return containsMacro(lines);
  }
  function buildMacroObjectFromRay(ray){
    const names = new Set();
    const scan = s => String(s||'').replace(/\$\(([A-Za-z0-9_]+)\)/g,(_,n)=>{ names.add(n); return ''; });
    (ray.commands||[]).forEach(scan);
    (ray.entity_checks||[]).forEach(e=>{ scan(e.selector); scan(e.cmd); });
    (ray.block_checks||[]).forEach(b=>{ scan(b.cmd); });
    return `{${Array.from(names).map(n=>`${n}:$(${n})`).join(',')}}`;
  }

  function normPoint(p){ return { commands:(p.commands||[]).map(String), offset:{ x:+p.offset?.x||0, y:+p.offset?.y||0, z:+p.offset?.z||0 } }; }
  function normRay(r){
    return {
      name: r.name||'Ray',
      step: +r.step||0.5,
      max_distance: Math.max(1, +r.max_distance||50),
      commands: (r.commands||[]).map(String),
      block_checks: Array.isArray(r.block_checks)? r.block_checks.map(b=>({ id:b.id||'#air', cmd:(b.cmd||'').toString(), pass:!!b.pass, invert:!!b.invert })) : [],
      entity_checks: Array.isArray(r.entity_checks)? r.entity_checks.map(e=>({ selector:(e.selector||'@e[distance=..0.6]').toString(), cmd:(e.cmd||'').toString(), pass:!!e.pass, invert:!!e.invert })) : [],
      collapsed: !!r.collapsed,
      enabled: r.enabled!==false
    };
  }

  // ---------- First render ----------
  drawGrid(); renderPoints(); renderEditor(); renderRays();

})();
