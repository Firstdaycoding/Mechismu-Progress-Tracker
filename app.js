// ═══════════════════════════════════════════════════════════════════════
// BACKEND CONFIG
// Put your backend's base URL here. Every request below is built from it:
//   GET  {url}/data    -> must return the full data JSON (see shape below)
//   POST {url}/data    -> body is the full data JSON, backend should persist it
//   POST {url}/login   -> body is { password }, backend returns an OK (2xx)
//                         status if the password is correct, and a non-2xx
//                         status (e.g. 401) if it is wrong.
//
// Expected shape of the data JSON (this is exactly what GET {url}/data
// should return, and exactly what gets sent back on POST {url}/data):
//
// {
//   "chassis": {
//     "2026-W25": { "targets": [{ "text": "...", "done": true }], "remarks": "..." },
//     "2026-W24": { ... },
//     "months": {
//       "2026-06": { "targets": [{ "text": "...", "done": false }] }
//     }
//   },
//   "drivetrain": { ... },
//   ...
// }
// ═══════════════════════════════════════════════════════════════════════
let url = 'http://127.0.0.1:5000/api';

// ═══════════════════════ CONSTANTS ═══════════════════════
const DIVISIONS = [
  {id:'chassis',    name:'Chassis',                     icon:'🏗️'},
  {id:'drivetrain', name:'Drivetrain',                  icon:'⚙️'},
  {id:'suspension', name:'Steering & Suspension',       icon:'🔧'},
  {id:'brakes',     name:'Brakes',                      icon:'🛑'},
  {id:'battery',    name:'Battery Pack & BMS',          icon:'🔋'},
  {id:'motor',      name:'Motor & Motor Controller',    icon:'⚡'},
  {id:'safety',     name:'Safety Circuits & LV System', icon:'🛡️'},
];

const LEAD_PW_KEY = 'password';

// ═══════════════════════ WEEK / MONTH UTILS ══════════════
function getWeekKey(date=new Date()){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const dow=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-dow);
  const ys=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const wk=Math.ceil(((d-ys)/86400000+1)/7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2,'0')}`;
}
function weekStartDate(key){
  const [yr,w]=key.split('-W');
  const d=new Date(Date.UTC(+yr,0,1));
  const dow=d.getUTCDay()||7;
  const s1=new Date(Date.UTC(+yr,0,1+(dow<=4?1-dow:8-dow)));
  return new Date(s1.getTime()+(+w-1)*7*86400000);
}
function weekLabel(key){
  const ws=weekStartDate(key);
  const we=new Date(ws.getTime()+6*86400000);
  const f=x=>x.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  return `${f(ws)} – ${f(we)}, ${ws.getUTCFullYear()}`;
}
function shiftWeek(key,delta){
  const ws=weekStartDate(key);
  ws.setUTCDate(ws.getUTCDate()+delta*7);
  return getWeekKey(ws);
}
function weekToMonthKey(key){
  const ws=weekStartDate(key);
  return `${ws.getUTCFullYear()}-${String(ws.getUTCMonth()+1).padStart(2,'0')}`;
}
function monthLabel(monthKey){
  const [y,m]=monthKey.split('-');
  return new Date(Date.UTC(+y,+m-1,1)).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
}

// ═══════════════════════ BACKEND API ═════════════════════
async function apiGetData(){
  const res=await fetch(url+'/data');
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}
async function apiSaveData(data){
    const adminpassword = localStorage.getItem(LEAD_PW_KEY);
    const res=await fetch(url+'/data',{
    method:'POST',
    headers:{'Content-Type':'application/json', 'X-Admin-Password': adminpassword},
    body:JSON.stringify(data)
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
}
async function apiCheckLogin(password){
  const res=await fetch(url+'/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password})
  });
  return res.ok;
}

// ═══════════════════════ APP STATE ═══════════════════════
const state={
  view:'overview',
  activeDivId:null,
  currentWeek:getWeekKey(),
  data:{},
  isAdmin:false,
  syncStatus:'loading',
  loading:true,
};

// ═══════════════════════ DATA HELPERS ════════════════════
function getDivWeek(divId,weekKey){
  if(!state.data[divId]) state.data[divId]={};
  if(!state.data[divId][weekKey]) state.data[divId][weekKey]={targets:[],remarks:''};
  return state.data[divId][weekKey];
}
function getDivMonth(divId,monthKey){
  if(!state.data[divId]) state.data[divId]={};
  if(!state.data[divId].months) state.data[divId].months={};
  if(!state.data[divId].months[monthKey]) state.data[divId].months[monthKey]={targets:[]};
  return state.data[divId].months[monthKey];
}
function getCompletion(entry){
  if(!entry||!entry.targets||!entry.targets.length) return null;
  return Math.round(entry.targets.filter(t=>t.done).length/entry.targets.length*100);
}
function getDivMeetings(divId){
  if(!state.data[divId]) state.data[divId]={};
  if(!state.data[divId].meetings) state.data[divId].meetings=[];
  return state.data[divId].meetings;
}
function formatMeetingDate(dateStr){
  if(!dateStr) return 'No date set';
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

// ═══════════════════════ SYNC (save to backend) ══════════
let _savePending=false, _saveTimer=null;
function scheduleSave(){
  _savePending=true;
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(flushSave,1500);
}
async function flushSave(){
  if(!_savePending) return;
  _savePending=false;
  setSyncStatus('saving');
  try{
    await apiSaveData(state.data);
    setSyncStatus('ok');
    showToast('✓ Saved');
  }catch(e){
    setSyncStatus('error',e.message);
    showToast('⚠ Save failed: '+e.message,true);
  }
}
function setSyncStatus(s,msg=''){
  state.syncStatus=s;
  const el=document.getElementById('sync-status');
  if(!el) return;
  const map={
    loading:'<span class="spinner"></span> Loading…',
    checking:'<span class="spinner"></span> Checking…',
    saving:'<span class="spinner"></span> Saving…',
    ok:'✓ Synced',
    error:'✗ Sync error'
  };
  const cls={loading:'saving',checking:'saving',saving:'saving',ok:'ok',error:'err'}[s]||'uncfg';
  el.innerHTML=msg?`✗ ${msg.slice(0,30)}`:(map[s]||'○ Idle');
  el.className='sync-status '+cls;
}

// ═══════════════════════ AUTH (backend-checked) ══════════
// On load, if a password is cached in localStorage, re-verify it with the
// backend rather than trusting it blindly. Edit/delete controls only ever
// render when state.isAdmin is true, which only happens after a 2xx from
// {url}/login.
async function checkStoredLogin(){
  const pw=localStorage.getItem(LEAD_PW_KEY);
  if(!pw) return;
  setSyncStatus('checking');
  try{
    const ok=await apiCheckLogin(pw);
    state.isAdmin=!!ok;
    if(!ok) localStorage.removeItem(LEAD_PW_KEY);
  }catch(e){
    // network/backend issue — don't wipe the saved password, just stay logged out for now
    state.isAdmin=false;
  }
}

async function handleAuthClick(){
  if(state.isAdmin){
    localStorage.removeItem(LEAD_PW_KEY);
    state.isAdmin=false;
    showToast('Logged out');
    render();
    return;
  }
  const pw=prompt('Enter lead password:');
  if(pw===null) return;
  setSyncStatus('checking');
  try{
    const ok=await apiCheckLogin(pw);
    if(ok){
      localStorage.setItem(LEAD_PW_KEY,pw);
      state.isAdmin=true;
      setSyncStatus('ok');
      showToast('✓ Logged in as lead');
    }else{
      setSyncStatus('ok');
      showToast('Incorrect password',true);
    }
  }catch(e){
    setSyncStatus('error',e.message);
    showToast('Login check failed: '+e.message,true);
  }
  render();
}

// ═══════════════════════ RENDER ══════════════════════════
function render(){
  renderTelemetry();
  renderSidebar();
  renderMain();
}

function renderTelemetry(){
  const {data,currentWeek}=state;
  let total=0,done=0,divsDone=0;
  DIVISIONS.forEach(div=>{
    const e=data[div.id]?.[currentWeek];
    if(e&&e.targets.length){
      total+=e.targets.length;
      const d=e.targets.filter(t=>t.done).length;
      done+=d;
      if(d===e.targets.length) divsDone++;
    }
  });
  const pct=total>0?Math.round(done/total*100):0;
  document.getElementById('tele-bar').style.width=pct+'%';
  document.getElementById('tele-stats').innerHTML=`
    <div class="tele-stat"><div class="tele-stat-val">${pct}%</div><div class="tele-stat-key">Complete</div></div>
    <div class="tele-stat"><div class="tele-stat-val">${done}</div><div class="tele-stat-key">Done</div></div>
    <div class="tele-stat"><div class="tele-stat-val">${total}</div><div class="tele-stat-key">Total</div></div>
    <div class="tele-stat"><div class="tele-stat-val">${divsDone}</div><div class="tele-stat-key">Divs✓</div></div>`;
  setSyncStatus(state.syncStatus);

  const badge=document.getElementById('mode-badge');
  badge.textContent=state.isAdmin?'LEAD':'VIEWER';
  badge.className='mode-badge '+(state.isAdmin?'edit-mode':'view-mode');
  const btn=document.getElementById('switch-mode-btn');
  btn.textContent=state.isAdmin?'→ Logout':'→ Lead Login';
  btn.onclick=handleAuthClick;
}

function renderSidebar(){
  const {data,currentWeek,view,activeDivId}=state;
  const c=document.getElementById('sidebar-divisions');
  c.innerHTML=DIVISIONS.map(div=>{
    const e=data[div.id]?.[currentWeek];
    const pct=getCompletion(e);
    const active=view==='division'&&activeDivId===div.id;
    return `<div class="sidebar-item ${active?'active':''}" data-div="${div.id}">
      <span class="div-icon">${div.icon}</span>
      <span class="div-name">${div.name}</span>
      <span class="div-pct">${pct!==null?pct+'%':'—'}</span>
    </div>`;
  }).join('');
  c.querySelectorAll('.sidebar-item').forEach(el=>{
    el.addEventListener('click',()=>{state.view='division';state.activeDivId=el.dataset.div;render();});
  });
  ['overview','monthly'].forEach(v=>{
    const el=document.getElementById('nav-'+v);
    if(el){el.className='sidebar-nav-item'+(view===v?' active':'');el.onclick=()=>{state.view=v;render();};}
  });
}

function renderMain(){
  const m=document.getElementById('main');
  if(state.view==='overview') m.innerHTML=buildOverview();
  else if(state.view==='monthly') m.innerHTML=buildMonthly();
  else if(state.view==='division') m.innerHTML=buildDivision(state.activeDivId);
  attachMainEvents();
}

// ═══════════════════════ BUILD OVERVIEW ══════════════════
function buildOverview(){
  const {data,currentWeek}=state;
  return `
    <div class="page-header">
      <h1>Team Overview</h1>
      <p>All divisions · ${weekLabel(currentWeek)}</p>
    </div>
    ${buildWeekNav()}
    <div class="overview-grid">
      ${DIVISIONS.map(div=>{
        const e=data[div.id]?.[currentWeek]||{targets:[],remarks:''};
        const total=e.targets.length, done=e.targets.filter(t=>t.done).length;
        const pct=total>0?Math.round(done/total*100):0;
        return `<div class="div-card" data-div="${div.id}">
          <div class="div-card-header">
            <span class="div-card-icon">${div.icon}</span>
            <span class="div-card-title">${div.name}</span>
            <span class="div-card-pct">${total>0?pct+'%':'—'}</span>
          </div>
          <div class="prog-bar-track"><div class="prog-bar-fill${pct<40&&total>0?' warn':''}" style="width:${pct}%"></div></div>
          <div class="div-card-meta">
            <span>${done}/${total} targets</span>
            <span>${e.remarks?'💬 has remarks':''}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// ═══════════════════════ BUILD MONTHLY (4-week trend view) ═══════════════
function buildMonthly(){
  const {data,currentWeek}=state;
  const weeks=[];let w=currentWeek;
  for(let i=0;i<4;i++){weeks.unshift(w);w=shiftWeek(w,-1);}
  return `
    <div class="page-header"><h1>Monthly Progress</h1><p>Last 4 weeks per division</p></div>
    <div class="monthly-grid">
      ${DIVISIONS.map(div=>{
        const wrows=weeks.map(wk=>{
          const e=data[div.id]?.[wk];
          const pct=getCompletion(e)??0;
          return `<div class="monthly-week-row">
            <span class="monthly-week-label">W${wk.split('-W')[1]}</span>
            <div class="monthly-week-bar"><div class="monthly-week-bar-fill" style="width:${pct}%"></div></div>
            <span class="monthly-week-pct">${getCompletion(e)!==null?pct+'%':'—'}</span>
          </div>`;
        }).join('');
        const avg=Math.round(weeks.map(wk=>getCompletion(data[div.id]?.[wk])??0).reduce((a,b)=>a+b,0)/weeks.length);
        return `<div class="monthly-div-card">
          <div class="monthly-div-title"><span class="monthly-div-icon">${div.icon}</span>${div.name}</div>
          <div class="monthly-weeks">${wrows}</div>
          <div class="monthly-avg"><span class="monthly-avg-label">4-week avg</span><span class="monthly-avg-val">${avg}%</span></div>
        </div>`;
      }).join('')}
    </div>`;
}

// ═══════════════════════ BUILD DIVISION ══════════════════
function buildDivision(divId){
  const div=DIVISIONS.find(d=>d.id===divId);
  const {data,currentWeek}=state;
  const isAdmin=state.isAdmin;
  const entry=getDivWeek(divId,currentWeek);
  const total=entry.targets.length, done=entry.targets.filter(t=>t.done).length;
  const pct=total>0?Math.round(done/total*100):0;
  const histKeys=Object.keys(data[divId]||{}).filter(k=>k!==currentWeek&&k!=='months'&&k!=='meetings').sort((a,b)=>b.localeCompare(a)).slice(0,10);
  const histHTML=histKeys.length?histKeys.map(wk=>{
    const e=data[divId][wk];
    const t=e.targets.length,d=e.targets.filter(x=>x.done).length,p=t>0?Math.round(d/t*100):0;
    return `<div class="history-week">
      <div class="history-week-header" data-wk="${wk}">
        <span class="history-week-label">W${wk.split('-W')[1]} · ${weekLabel(wk)}</span>
        <span class="history-week-pct">${t>0?p+'%':'—'}</span>
        <span class="history-week-chevron">▶</span>
      </div>
      <div class="history-week-body" id="hist-${wk}">
        ${e.targets.map(tg=>`<div class="history-target ${tg.done?'done':''}">${esc(tg.text)}</div>`).join('')||'<div style="color:var(--muted);font-size:12px">No targets recorded.</div>'}
        ${e.remarks?`<div class="history-remarks"><div class="history-remarks-label">Remarks</div>${esc(e.remarks)}</div>`:''}
      </div>
    </div>`;
  }).join(''):`<div class="empty-history">No history yet for this division.</div>`;

  return `
    <div class="detail-header">
      <span class="detail-icon">${div.icon}</span>
      <div><div class="detail-title">${div.name}</div><div class="detail-subtitle">${weekLabel(currentWeek)}</div></div>
      <button class="detail-back" id="back-btn">← All Divisions</button>
    </div>
    ${buildWeekNav()}
    <div class="section-card">
      <div class="section-card-title">Week Progress</div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px">
        <div style="flex:1"><div class="prog-bar-track" style="height:10px"><div class="prog-bar-fill${pct<40&&total>0?' warn':''}" style="width:${pct}%"></div></div></div>
        <div style="font-family:var(--mono);font-size:22px;font-weight:700;color:var(--accent);min-width:48px;text-align:right">${pct}%</div>
      </div>
      <div style="display:flex;gap:24px;font-family:var(--mono);font-size:12px;color:var(--text2)">
        <span>✅ ${done} completed</span><span>○ ${total-done} pending</span><span>📋 ${total} total</span>
      </div>
    </div>
    <div class="section-card">
      <div class="section-card-title">Weekly Targets</div>
      <div class="targets-list" id="targets-list">
        ${entry.targets.length?entry.targets.map((t,i)=>`
          <div class="target-row ${t.done?'done':''}" data-idx="${i}">
            <div class="target-check ${t.done?'checked':''}" data-check="${i}"></div>
            <span class="target-text">${esc(t.text)}</span>
            ${isAdmin?`<button class="target-del" data-del="${i}">✕</button>`:''}
          </div>`).join(''):
          `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">${isAdmin?'No targets yet. Add one below.':'No targets set for this week.'}</div>`}
      </div>
      ${isAdmin?`<div class="add-target-row">
        <input class="add-target-input" id="new-target-input" placeholder="Add a new target… (press Enter)" maxlength="200">
        <button class="add-target-btn" id="add-target-btn">+ Add</button>
      </div>`:''}
    </div>
    ${buildMonthlyTargetsCard(divId)}
    ${buildMeetingsCard(divId)}
    <div class="section-card">
      <div class="section-card-title">Week Remarks / Notes</div>
      <textarea class="remarks-box" id="remarks-box" ${!isAdmin?'disabled':''}
        placeholder="Add notes, blockers, decisions, or observations for this week…">${esc(entry.remarks)}</textarea>
      ${isAdmin?`<button class="save-btn" id="save-remarks-btn">Save Remarks</button>`:''}
    </div>
    <div class="section-card">
      <div class="section-card-title">Past Weeks History</div>
      ${histHTML}
    </div>`;
}

// Monthly targets are independent of weekly targets — multiple per division
// per calendar month, scoped to the month the currently-selected week falls in.
function buildMonthlyTargetsCard(divId){
  const isAdmin=state.isAdmin;
  const monthKey=weekToMonthKey(state.currentWeek);
  const mEntry=getDivMonth(divId,monthKey);
  const total=mEntry.targets.length, done=mEntry.targets.filter(t=>t.done).length;
  const pct=total>0?Math.round(done/total*100):0;
  return `
    <div class="section-card">
      <div class="section-card-title">Monthly Targets · ${monthLabel(monthKey)}</div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
        <div style="flex:1"><div class="prog-bar-track" style="height:8px"><div class="prog-bar-fill${pct<40&&total>0?' warn':''}" style="width:${pct}%"></div></div></div>
        <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:var(--accent);min-width:42px;text-align:right">${total>0?pct+'%':'—'}</div>
      </div>
      <div class="targets-list" id="month-targets-list">
        ${mEntry.targets.length?mEntry.targets.map((t,i)=>`
          <div class="target-row ${t.done?'done':''}" data-midx="${i}">
            <div class="target-check ${t.done?'checked':''}" data-mcheck="${i}"></div>
            <span class="target-text">${esc(t.text)}</span>
            ${isAdmin?`<button class="target-del" data-mdel="${i}">✕</button>`:''}
          </div>`).join(''):
          `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">${isAdmin?'No monthly targets yet. Add one below.':'No monthly targets set for this month.'}</div>`}
      </div>
      ${isAdmin?`<div class="add-target-row">
        <input class="add-target-input" id="new-month-target-input" placeholder="Add a monthly target… (press Enter)" maxlength="200">
        <button class="add-target-btn" id="add-month-target-btn">+ Add</button>
      </div>`:''}
    </div>`;
}

// Meetings are a flat, independent list per division: date, time, an agenda,
// and the decisions that came out of it. Not tied to a specific week/month.
function buildMeetingsCard(divId){
  const isAdmin=state.isAdmin;
  const meetings=getDivMeetings(divId);
  const ordered=meetings
    .map((m,idx)=>({m,idx}))
    .sort((a,b)=>(b.m.date+(b.m.time||'')).localeCompare(a.m.date+(a.m.time||'')));

  const listHTML=ordered.length?ordered.map(({m,idx})=>{
    const preview=m.agenda?(m.agenda.length>34?esc(m.agenda.slice(0,34))+'…':esc(m.agenda)):'No agenda';
    return `
    <div class="history-week">
      <div class="history-week-header" data-meeting="${idx}">
        <span class="history-week-label">${esc(formatMeetingDate(m.date))}${m.time?' · '+esc(m.time):''}</span>
        <span class="history-week-pct" style="font-size:11px;font-weight:500;color:var(--text2)">${preview}</span>
        <span class="history-week-chevron">▶</span>
      </div>
      <div class="history-week-body" id="meeting-body-${idx}">
        <div class="history-remarks">
          <div class="history-remarks-label">Agenda</div>
          ${m.agenda?esc(m.agenda):'<span style="color:var(--muted)">No agenda recorded.</span>'}
        </div>
        <div class="history-remarks" style="margin-top:8px">
          <div class="history-remarks-label">Decisions Made</div>
          ${m.decisions?esc(m.decisions):'<span style="color:var(--muted)">No decisions recorded yet.</span>'}
        </div>
        ${isAdmin?`<button class="target-del" data-meetingdel="${idx}" style="margin-top:10px;font-size:12px">✕ Delete this meeting</button>`:''}
      </div>
    </div>`;
  }).join(''):`<div class="empty-history">No meetings logged yet for this division.</div>`;

  return `
    <div class="section-card">
      <div class="section-card-title">Meetings</div>
      ${listHTML}
      ${isAdmin?`
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
          <div class="modal-field">
            <label class="modal-label">Date</label>
            <input class="modal-input" type="date" id="meeting-date-input">
          </div>
          <div class="modal-field">
            <label class="modal-label">Time</label>
            <input class="modal-input" type="time" id="meeting-time-input">
          </div>
          <div class="modal-field">
            <label class="modal-label">Agenda</label>
            <textarea class="remarks-box" id="meeting-agenda-input" style="min-height:60px" placeholder="What this meeting is about…"></textarea>
          </div>
          <div class="modal-field">
            <label class="modal-label">Decisions Made</label>
            <textarea class="remarks-box" id="meeting-decisions-input" style="min-height:60px" placeholder="What was decided…"></textarea>
          </div>
          <button class="add-target-btn" id="add-meeting-btn">+ Add Meeting</button>
        </div>`:''}
    </div>`;
}

function buildWeekNav(){
  const {currentWeek}=state;
  const todayKey=getWeekKey();
  const isCurrent=currentWeek===todayKey;
  return `<div class="week-nav">
    <button class="week-nav-btn" id="prev-week">← Prev</button>
    <span class="week-nav-current ${isCurrent?'is-current':''}">Week ${currentWeek.split('-W')[1]} · ${weekLabel(currentWeek)}</span>
    <button class="week-nav-btn" id="next-week" ${isCurrent?'disabled':''}>Next →</button>
    ${!isCurrent?`<button class="week-nav-btn" id="go-current" style="border-color:rgba(200,244,0,.3);color:var(--accent)">↩ Current</button>`:''}
  </div>`;
}

// ═══════════════════════ EVENTS ══════════════════════════
function attachMainEvents(){
  document.querySelectorAll('.div-card').forEach(el=>{
    el.addEventListener('click',()=>{state.view='division';state.activeDivId=el.dataset.div;render();});
  });
  const back=document.getElementById('back-btn');
  if(back) back.addEventListener('click',()=>{state.view='overview';render();});
  const pBtn=document.getElementById('prev-week');
  const nBtn=document.getElementById('next-week');
  const cBtn=document.getElementById('go-current');
  if(pBtn) pBtn.addEventListener('click',()=>{state.currentWeek=shiftWeek(state.currentWeek,-1);render();});
  if(nBtn) nBtn.addEventListener('click',()=>{state.currentWeek=shiftWeek(state.currentWeek,1);render();});
  if(cBtn) cBtn.addEventListener('click',()=>{state.currentWeek=getWeekKey();render();});

  // weekly targets
  document.querySelectorAll('[data-check]').forEach(el=>{
    el.addEventListener('click',()=>{
      if(!state.isAdmin){showToast('Log in as lead to make changes',true);return;}
      const i=+el.dataset.check;
      const e=getDivWeek(state.activeDivId,state.currentWeek);
      e.targets[i].done=!e.targets[i].done;
      scheduleSave(); render();
    });
  });
  document.querySelectorAll('[data-del]').forEach(el=>{
    el.addEventListener('click',()=>{
      if(!state.isAdmin) return;
      const i=+el.dataset.del;
      if(!confirm('Delete this target?')) return;
      const e=getDivWeek(state.activeDivId,state.currentWeek);
      e.targets.splice(i,1);
      scheduleSave(); render();
    });
  });
  const addBtn=document.getElementById('add-target-btn');
  const addInp=document.getElementById('new-target-input');
  if(addBtn&&addInp){
    const doAdd=()=>{
      const txt=addInp.value.trim();
      if(!txt) return;
      const e=getDivWeek(state.activeDivId,state.currentWeek);
      e.targets.push({text:txt,done:false});
      scheduleSave(); render();
      setTimeout(()=>{const i=document.getElementById('new-target-input');if(i)i.focus();},50);
    };
    addBtn.addEventListener('click',doAdd);
    addInp.addEventListener('keydown',ev=>{if(ev.key==='Enter') doAdd();});
  }

  // monthly targets
  document.querySelectorAll('[data-mcheck]').forEach(el=>{
    el.addEventListener('click',()=>{
      if(!state.isAdmin){showToast('Log in as lead to make changes',true);return;}
      const i=+el.dataset.mcheck;
      const monthKey=weekToMonthKey(state.currentWeek);
      const m=getDivMonth(state.activeDivId,monthKey);
      m.targets[i].done=!m.targets[i].done;
      scheduleSave(); render();
    });
  });
  document.querySelectorAll('[data-mdel]').forEach(el=>{
    el.addEventListener('click',()=>{
      if(!state.isAdmin) return;
      const i=+el.dataset.mdel;
      if(!confirm('Delete this monthly target?')) return;
      const monthKey=weekToMonthKey(state.currentWeek);
      const m=getDivMonth(state.activeDivId,monthKey);
      m.targets.splice(i,1);
      scheduleSave(); render();
    });
  });
  const addMBtn=document.getElementById('add-month-target-btn');
  const addMInp=document.getElementById('new-month-target-input');
  if(addMBtn&&addMInp){
    const doAddM=()=>{
      const txt=addMInp.value.trim();
      if(!txt) return;
      const monthKey=weekToMonthKey(state.currentWeek);
      const m=getDivMonth(state.activeDivId,monthKey);
      m.targets.push({text:txt,done:false});
      scheduleSave(); render();
      setTimeout(()=>{const i=document.getElementById('new-month-target-input');if(i)i.focus();},50);
    };
    addMBtn.addEventListener('click',doAddM);
    addMInp.addEventListener('keydown',ev=>{if(ev.key==='Enter') doAddM();});
  }

  // remarks
  const saveRem=document.getElementById('save-remarks-btn');
  const remBox=document.getElementById('remarks-box');
  if(saveRem&&remBox){
    saveRem.addEventListener('click',()=>{
      if(!state.isAdmin) return;
      const e=getDivWeek(state.activeDivId,state.currentWeek);
      e.remarks=remBox.value;
      scheduleSave(); renderTelemetry(); renderSidebar();
      showToast('Remarks queued for save…');
    });
  }

  // history accordion (weekly history)
  document.querySelectorAll('.history-week-header[data-wk]').forEach(el=>{
    el.addEventListener('click',()=>{
      const wk=el.dataset.wk;
      const body=document.getElementById('hist-'+wk);
      const ch=el.querySelector('.history-week-chevron');
      body.classList.toggle('open'); ch.classList.toggle('open');
    });
  });

  // meetings
  document.querySelectorAll('.history-week-header[data-meeting]').forEach(el=>{
    el.addEventListener('click',()=>{
      const idx=el.dataset.meeting;
      const body=document.getElementById('meeting-body-'+idx);
      const ch=el.querySelector('.history-week-chevron');
      body.classList.toggle('open'); ch.classList.toggle('open');
    });
  });
  document.querySelectorAll('[data-meetingdel]').forEach(el=>{
    el.addEventListener('click',(ev)=>{
      ev.stopPropagation();
      if(!state.isAdmin) return;
      const idx=+el.dataset.meetingdel;
      if(!confirm('Delete this meeting?')) return;
      const meetings=getDivMeetings(state.activeDivId);
      meetings.splice(idx,1);
      scheduleSave(); render();
    });
  });
  const addMeetingBtn=document.getElementById('add-meeting-btn');
  if(addMeetingBtn){
    addMeetingBtn.addEventListener('click',()=>{
      if(!state.isAdmin){showToast('Log in as lead to make changes',true);return;}
      const dateEl=document.getElementById('meeting-date-input');
      const timeEl=document.getElementById('meeting-time-input');
      const agendaEl=document.getElementById('meeting-agenda-input');
      const decisionsEl=document.getElementById('meeting-decisions-input');
      if(!dateEl.value){showToast('Pick a date for the meeting',true);return;}
      const meetings=getDivMeetings(state.activeDivId);
      meetings.push({
        date:dateEl.value,
        time:timeEl.value||'',
        agenda:agendaEl.value.trim(),
        decisions:decisionsEl.value.trim()
      });
      scheduleSave(); render();
    });
  }
}

// ═══════════════════════ UTILS ═══════════════════════════
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showToast(msg,err=false){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='show'+(err?' err':'');
  clearTimeout(el._t); el._t=setTimeout(()=>el.className='',3000);
}

// ═══════════════════════ INIT ════════════════════════════
async function init(){
  render(); // skeleton first
  setSyncStatus('loading');
  try{
    state.data=await apiGetData();
    setSyncStatus('ok');
  }catch(e){
    setSyncStatus('error',e.message);
    showToast('Could not load data from backend: '+e.message,true);
  }
  await checkStoredLogin();
  state.loading=false;
  render();
}
init();