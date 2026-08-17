(function(){
  // Browser fallback: Claude artifacts use window.storage; locally we use localStorage.
  if (typeof window.storage === "undefined" || !window.storage) {
    window.storage = {
      _local: true,
      get: async function(key) {
        try { return { value: localStorage.getItem(key) }; }
        catch (e) { return { value: null }; }
      },
      set: async function(key, value) {
        try { localStorage.setItem(key, value); return true; }
        catch (e) { return false; }
      },
      list: async function(prefix) {
        const keys = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(prefix) === 0) keys.push(k);
          }
        } catch (e) { /* ignore */ }
        return { keys: keys };
      }
    };
  }

  const DAY_PREFIX = "amir:day:v2:";
  const TASKS_KEY = "amir:tasks:v3";
  const DOCS_KEY = "amir:docs";
  const EVENTS_KEY = "amir:events";
  const RECIPES_KEY = "amir:recipes";
  const LIBRES_KEY = "amir:libres";
  const BONUS_KEY = "amir:bonus2";
  const ANNUAL_PAID_DAYS = 10; // 2 semanas x 5 días laborables
  const SHARED = false; // personal storage — avoids the "Access shared data" permission gate that was failing
  const DOC_CATS = ["Horario del Bebé","Contrato","Actividades de Desarrollo","Resúmenes del Doctor","Otro"];
  const REC_CATS = ["Desayunos","Meriendas","Res","Cordero","Pollo","Pavo","Pescados","Mariscos","Batidos","Pastas","Granos"];

  const DEFAULT_TASKS = [
    { id:"a1", section:"actividades", text:"Espray nasal (NoseFrida)" },
    { id:"a2", section:"actividades", text:"Gatear diario (obligatorio, varias veces)" },
    { id:"a3", section:"actividades", text:"Caminar agarrado de la mano (varias veces)" },
    { id:"a4", section:"actividades", text:"Ejercicios de desarrollo: pararse y sentarse (2 sesiones x 8-10 rep)" },
    { id:"a5", section:"actividades", text:"Estimulación sensorial (libros con texturas)" },
    { id:"a6", section:"actividades", text:"Paseos / aire libre (2x semana)" },
    { id:"h1", section:"hogar", text:"Lavar y desinfectar biberones" },
    { id:"h2", section:"hogar", text:"Preparación de comida (lunes y jueves)" },
    { id:"h3", section:"hogar", text:"Rellenar pañales y toallitas húmedas" },
    { id:"h4", section:"hogar", text:"Ordenar habitación" },
    { id:"h5", section:"hogar", text:"Botar basura de la habitación" },
    { id:"h6", section:"hogar", text:"Lavado de ropa (mínimo 1x por semana)" },
    { id:"h7", section:"hogar", text:"Doblar y acomodar ropa" },
    { id:"h8", section:"hogar", text:"Organizar área de juego / juguetes" },
    { id:"h9", section:"hogar", text:"Limpiar, aspirar y sacudir habitación (1x semana)" },
    { id:"h10", section:"hogar", text:"Remover ropa pequeña de gaveta y closet — guardar en bolsa plástica (1x mes)" },
  ];

  let role = "niñera";
  let today = new Date();
  let currentDate = new Date();
  let dayData = { locked:false, signedAt:null, items:[], notes:{humor:"",cambios:"",situaciones:""} };
  let templateTasks = [];
  let docs = [], events = [], recipes = [], libres = [];
  let docFilter = "Todos";
  let calViewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let calSelected = new Date();

  // ---------- helpers ----------
  function isoLocal(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; }
  function fmtDateLong(d){ let s = new Intl.DateTimeFormat("es-ES", {weekday:"long", day:"numeric", month:"long"}).format(d); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtDateShort(dateStr){ const [y,m,d] = dateStr.split("-").map(Number); let s = new Intl.DateTimeFormat("es-ES", {weekday:"short", day:"numeric", month:"short"}).format(new Date(y,m-1,d)); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtTime12(hhmm){
    if(!hhmm) return "";
    const [h,m] = hhmm.split(":").map(Number);
    const d = new Date(); d.setHours(h,m,0,0);
    const s = d.toLocaleTimeString("es-ES", {hour:"numeric", minute:"2-digit", hour12:true});
    return s.replace(/\s*a\.?\s*m\.?/i, "am").replace(/\s*p\.?\s*m\.?/i, "pm");
  }
  function nowHHMM(){ const d = new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
  function escapeHtml(s){ const d=document.createElement("div"); d.textContent=s||""; return d.innerHTML; }
  function uid(){ return Date.now()+"-"+Math.random().toString(36).slice(2,7); }
  function isCookingDay(d){ const dow = d.getDay(); return dow===1 || dow===4; } // lunes=1, jueves=4

  function showError(show, msg){
    document.getElementById("globalError").classList.toggle("show", !!show);
    if(show) document.getElementById("globalErrorText").textContent = msg || "No se pudo guardar.";
  }
  async function getJSON(key, fallback){
    try{ const res = await window.storage.get(key, SHARED); return res && res.value ? JSON.parse(res.value) : fallback; }
    catch(e){ return fallback; }
  }
  async function setJSON(key, val, silent){
    if(typeof window.storage === "undefined" || !window.storage){
      if(!silent) showError(true, "El almacenamiento no está disponible en este navegador. Abre el enlace de la app directamente (no como archivo descargado) y permite el acceso a datos compartidos si el navegador lo pregunta.");
      return false;
    }
    try{
      const ok = !!(await window.storage.set(key, JSON.stringify(val), SHARED));
      if(ok) showError(false); else if(!silent) showError(true, "No se pudo guardar (el navegador rechazó la escritura). Toca \"Probar de nuevo\" o revisa el permiso de datos compartidos.");
      return ok;
    }catch(e){
      if(!silent) showError(true, "No se pudo guardar: " + (e && e.message ? e.message : "error desconocido") + ". Toca \"Probar de nuevo\".");
      return false;
    }
  }
  function updateDiag(extra){
    const el = document.getElementById("diagStatus");
    if(!el) return;
    const hasStorage = typeof window.storage !== "undefined" && !!window.storage;
    const mode = (window.storage && window.storage._local)
      ? "Este iPhone / este navegador (se guarda solo aquí)"
      : "Personal (no compartido)";
    el.innerHTML = `
      <div>window.storage detectado: <b>${hasStorage ? "Sí" : "No"}</b></div>
      <div>Modo: <b>${mode}</b></div>
      <div>Última prueba de guardado: <b>${extra && extra.result ? extra.result : "pendiente…"}</b></div>
      ${extra && extra.detail ? `<div style="margin-top:4px;">${escapeHtml(extra.detail)}</div>` : ""}
    `;
  }
  updateDiag();
  async function storageSelfTest(){
    const testKey = "amir:_selftest";
    const ok = await setJSON(testKey, {t:Date.now()}, true);
    if(ok){
      updateDiag({result:"✅ Éxito", detail:"El guardado se confirmó a las "+nowHHMM()+"."});
    } else {
      updateDiag({result:"❌ Falló", detail:"window.storage.set() no confirmó el guardado. Usa el respaldo manual mientras tanto."});
      showError(true, "El guardado automático no está disponible ahora mismo. La app sigue funcionando, pero usa \"Compartir o copiar respaldo\" en Inicio antes de cerrarla.");
    }
    return ok;
  }
  document.getElementById("retryStorage").addEventListener("click", async ()=>{
    showError(false);
    const ok = await storageSelfTest();
    if(ok) showError(false);
  });
  async function setJSONRetry(key, val, attempts){
    attempts = attempts || 3;
    for(let i=0;i<attempts;i++){
      const ok = await setJSON(key, val, true); // silent — this is a background/init write, never show the error banner for it
      if(ok) return true;
      await new Promise(r=> setTimeout(r, 400));
    }
    return false;
  }
  function itemFromTemplate(t){ return { id:t.id, section:t.section, text:t.text, done:false }; }

  // ---------- TABS ----------
  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".form-modal-bg").forEach(m=> m.classList.add("hidden"));
      document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t=>t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-"+btn.getAttribute("data-tab")).classList.add("active");
      if(btn.getAttribute("data-tab")==="inicio") renderInicio();
    });
  });

  // ---------- ROLE TOGGLE (synced across tabs) ----------
  function setRole(r){
    role = r;
    [["roleNinera","rolePadres"],["roleNineraH","rolePadresH"]].forEach(pair=>{
      document.getElementById(pair[0]).classList.toggle("active", r==="niñera");
      document.getElementById(pair[1]).classList.toggle("active", r==="padres");
    });
    renderChecklist();
    renderInicio();
    renderLibres();
    renderRecetas();
  }
  document.getElementById("roleNinera").addEventListener("click", ()=> setRole("niñera"));
  document.getElementById("rolePadres").addEventListener("click", ()=> requestPadresAccess());
  document.getElementById("roleNineraH").addEventListener("click", ()=> setRole("niñera"));
  document.getElementById("rolePadresH").addEventListener("click", ()=> requestPadresAccess());

  // ---------- PIN protection for Padres view ----------
  const PADRES_PIN = "4270";
  function requestPadresAccess(){
    const modal = document.getElementById("pinModalBg");
    const input = document.getElementById("pinInput");
    document.getElementById("pinError").classList.remove("show");
    input.value = "";
    modal.classList.remove("hidden");
    setTimeout(()=> input.focus(), 50);
  }
  function closePinModal(){ document.getElementById("pinModalBg").classList.add("hidden"); }
  function tryPin(){
    const val = document.getElementById("pinInput").value.trim();
    if(val === PADRES_PIN){
      closePinModal();
      setRole("padres");
    } else {
      document.getElementById("pinError").classList.add("show");
      document.getElementById("pinInput").value = "";
      document.getElementById("pinInput").focus();
    }
  }
  document.getElementById("pinConfirm").addEventListener("click", tryPin);
  document.getElementById("pinCancel").addEventListener("click", closePinModal);
  document.getElementById("pinInput").addEventListener("keydown", (e)=>{ if(e.key==="Enter") tryPin(); });
  document.getElementById("pinModalBg").addEventListener("click", (e)=>{ if(e.target.id==="pinModalBg") closePinModal(); });

  // ---------- form pop-ups ----------
  function wireModalToggle(openBtnId, bgId, closeBtnId){
    const bg = document.getElementById(bgId);
    document.getElementById(openBtnId).addEventListener("click", ()=> bg.classList.remove("hidden"));
    document.getElementById(closeBtnId).addEventListener("click", ()=> bg.classList.add("hidden"));
    bg.addEventListener("click", (e)=>{ if(e.target === bg) bg.classList.add("hidden"); });
  }
  wireModalToggle("toggleEventForm","eventFormBg","closeEventForm");
  wireModalToggle("toggleRecForm","recFormBg","closeRecForm");
  wireModalToggle("toggleLibreForm","libreFormBg","closeLibreForm");

  // ---------- DAY NAV (Hoy) ----------
  document.getElementById("prevDay").addEventListener("click", ()=>{ const d=new Date(currentDate); d.setDate(d.getDate()-1); goToDay(d); });
  document.getElementById("nextDay").addEventListener("click", ()=>{ if(document.getElementById("nextDay").disabled) return; const d=new Date(currentDate); d.setDate(d.getDate()+1); goToDay(d); });
  document.getElementById("gotoToday").addEventListener("click", ()=> goToDay(new Date()));
  document.getElementById("dismissBanner").addEventListener("click", ()=>{ document.getElementById("signedBanner").style.display="none"; });

  async function goToDay(d){
    currentDate = new Date(d);
    document.getElementById("signedBanner").style.display = "none";
    dayData = await loadDay(currentDate);
    renderHeaderNav();
    renderChecklist();
  }
  function renderHeaderNav(){
    document.getElementById("dayLabel").textContent = fmtDateLong(currentDate);
    const isToday = isoLocal(currentDate) === isoLocal(today);
    document.getElementById("gotoToday").style.display = isToday ? "none" : "inline-block";
    document.getElementById("nextDay").disabled = isToday;
    renderWeekStrip();
  }

  async function renderWeekStrip(){
    const el = document.getElementById("weekStrip");
    if(!el) return;
    const DOW = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay()); // Sunday of the current real week
    const monthLabel = new Intl.DateTimeFormat("es-ES", {month:"short", year:"numeric"}).format(weekStart);
    const isos = [];
    for(let i=0;i<7;i++){ const d = new Date(weekStart); d.setDate(weekStart.getDate()+i); isos.push(isoLocal(d)); }
    const importantFlags = await Promise.all(isos.map(iso => getJSON(DAY_PREFIX+iso, null).then(d => !!(d && d.important))));
    let html = `<div class="wk-month">${escapeHtml(monthLabel)}</div>`;
    isos.forEach((iso, i)=>{
      const [y,m,dd] = iso.split("-").map(Number);
      const d = new Date(y, m-1, dd);
      const isToday = iso === isoLocal(today);
      const isSel = iso === isoLocal(currentDate);
      html += `
        <div class="wk-day ${isToday?'is-today':''} ${isSel?'is-selected':''}" data-iso="${iso}">
          <div class="wk-dow">${DOW[i]}</div>
          <div class="wk-num">${d.getDate()}</div>
          <div class="wk-star">${importantFlags[i] ? '⭐' : ''}</div>
        </div>`;
    });
    el.innerHTML = html;
    el.querySelectorAll(".wk-day").forEach(cell=>{
      cell.addEventListener("click", ()=>{
        const [y,m,dd] = cell.getAttribute("data-iso").split("-").map(Number);
        goToDay(new Date(y, m-1, dd));
      });
    });
  }

  const TASK_TEXT_FIXES = { "a6": "Paseos / aire libre (2x semana)" };
  function migrateTaskTexts(items){
    let changed = false;
    items.forEach(item=>{
      if(TASK_TEXT_FIXES[item.id] && item.text !== TASK_TEXT_FIXES[item.id]){
        item.text = TASK_TEXT_FIXES[item.id];
        changed = true;
      }
    });
    return changed;
  }

  async function loadDay(d){
    const saved = await getJSON(DAY_PREFIX + isoLocal(d), null);
    if(saved){
      if(!saved.notes) saved.notes = {humor:"",cambios:"",situaciones:""};
      if(migrateTaskTexts(saved.items)) await setJSON(DAY_PREFIX + isoLocal(d), saved);
      return saved;
    }
    return { locked:false, signedAt:null, items: templateTasks.map(itemFromTemplate), notes:{humor:"",cambios:"",situaciones:""} };
  }
  async function saveDay(){ await setJSON(DAY_PREFIX + isoLocal(currentDate), dayData); }

  function renderChecklist(){
    const total = dayData.items.length;
    const done = dayData.items.filter(i=>i.done).length;
    document.getElementById("progressCount").textContent = `${done}/${total}`;
    document.getElementById("progressFill").style.width = total ? `${(done/total)*100}%` : "0%";

    const lockRow = document.getElementById("lockRow");
    lockRow.style.display = dayData.locked ? "flex" : "none";
    if(dayData.locked) document.getElementById("lockText").textContent = `🔒 Firmado a las ${dayData.signedAt} — checklist bloqueado`;
    document.getElementById("unlockLink").style.display = (dayData.locked && role==="niñera") ? "inline" : "none";
    document.getElementById("signBtn").style.display = (role==="niñera" && !dayData.locked) ? "block" : "none";

    document.getElementById("importantToggle").classList.toggle("active", !!dayData.important);

    const readonly = dayData.locked || role==="padres";
    renderSection("actividades", "listActividades", readonly);
    renderSection("hogar", "listHogar", readonly);
    renderNotes(readonly);

    document.getElementById("templateCard").style.display = role==="padres" ? "block" : "none";
    if(role==="padres") renderTemplate();
  }
  document.getElementById("importantToggle").addEventListener("click", ()=>{
    dayData.important = !dayData.important;
    renderChecklist();
    saveDay().then(()=> renderWeekStrip());
  });

  let importantListOpen = false;
  document.getElementById("toggleImportantList").addEventListener("click", async ()=>{
    importantListOpen = !importantListOpen;
    const listEl = document.getElementById("importantDaysList");
    listEl.style.display = importantListOpen ? "block" : "none";
    if(!importantListOpen) return;
    listEl.innerHTML = `<div class="empty" style="padding:16px 4px;"><p>Buscando…</p></div>`;
    try{
      const res = await window.storage.list(DAY_PREFIX, SHARED);
      const keys = (res && res.keys) ? res.keys : [];
      const days = [];
      for(const k of keys){
        try{
          const r = await window.storage.get(k, SHARED);
          if(!r || !r.value) continue;
          const d = JSON.parse(r.value);
          if(d.important){
            const iso = k.replace(DAY_PREFIX, "");
            const preview = d.notes && d.notes.situaciones ? d.notes.situaciones : (d.notes && d.notes.cambios ? d.notes.cambios : "");
            days.push({ iso, preview });
          }
        }catch(e){ /* skip unreadable */ }
      }
      days.sort((a,b)=> b.iso.localeCompare(a.iso));
      if(!days.length){
        listEl.innerHTML = `<div class="empty" style="padding:16px 4px;"><p>Aún no has marcado ningún día como importante.</p></div>`;
        return;
      }
      listEl.innerHTML = days.map(d => `
        <div class="imp-day-item" data-iso="${d.iso}">
          <div>
            <div class="imp-date">⭐ ${fmtDateShort(d.iso)}</div>
            ${d.preview ? `<div class="imp-preview">${escapeHtml(d.preview)}</div>` : ""}
          </div>
          <span style="color:var(--ink-soft);">›</span>
        </div>`).join("");
      listEl.querySelectorAll(".imp-day-item").forEach(item=>{
        item.addEventListener("click", ()=>{
          const [y,m,dd] = item.getAttribute("data-iso").split("-").map(Number);
          goToDay(new Date(y,m-1,dd));
          listEl.style.display = "none";
          importantListOpen = false;
        });
      });
    }catch(e){
      listEl.innerHTML = `<div class="empty" style="padding:16px 4px;"><p>No se pudo cargar la lista.</p></div>`;
    }
  });

  function renderSection(section, elId, readonly){
    const el = document.getElementById(elId);
    const items = dayData.items.filter(i=>i.section===section);
    if(!items.length){ el.innerHTML = `<div class="empty" style="padding:14px 4px;"><p>No hay tareas en esta sección todavía.</p></div>`; return; }
    el.innerHTML = items.map(item => `
      <div class="simple-row ${readonly?'readonly':''}" data-id="${item.id}">
        <div class="simple-check ${item.done?'done':''}">${item.done?'✓':''}</div>
        <div class="simple-text ${item.done?'done':''}">${escapeHtml(item.text)}</div>
      </div>`).join("");
    if(!readonly){
      el.querySelectorAll(".simple-row").forEach(row=>{
        row.addEventListener("click", ()=>{
          const id = row.getAttribute("data-id");
          const item = dayData.items.find(i=>i.id===id);
          item.done = !item.done;
          renderChecklist();
          saveDay();
        });
      });
    }
  }

  function renderNotes(readonly){
    const fields = [ {key:"humor", wrap:"notesHumorWrap"}, {key:"cambios", wrap:"notesCambiosWrap"}, {key:"situaciones", wrap:"notesSituacionesWrap"} ];
    fields.forEach(f=>{
      const wrap = document.getElementById(f.wrap);
      if(readonly){ wrap.innerHTML = `<div class="readonly-text">${escapeHtml(dayData.notes[f.key]||"")}</div>`; }
      else{
        wrap.innerHTML = `<textarea data-key="${f.key}">${escapeHtml(dayData.notes[f.key]||"")}</textarea>`;
        wrap.querySelector("textarea").addEventListener("change", async (e)=>{ dayData.notes[f.key] = e.target.value; await saveDay(); });
      }
    });
  }

  document.getElementById("signBtn").addEventListener("click", async ()=>{
    dayData.locked = true; dayData.signedAt = nowHHMM();
    await saveDay();
    document.getElementById("signedBanner").style.display = "flex";
    renderChecklist();
  });
  document.getElementById("unlockLink").addEventListener("click", async ()=>{
    dayData.locked = false; dayData.signedAt = null;
    await saveDay();
    document.getElementById("signedBanner").style.display = "none";
    renderChecklist();
  });

  function renderTemplate(){
    const el = document.getElementById("tplList");
    if(!templateTasks.length){ el.innerHTML = `<div class="empty" style="padding:16px 4px;"><p>No hay tareas en la plantilla.</p></div>`; return; }
    el.innerHTML = templateTasks.map(t => `
      <div class="tpl-item">
        <span class="tpl-sec">${t.section==='actividades'?'Activ.':'Hogar'}</span>
        <span style="flex:1;">${escapeHtml(t.text)}</span>
        <button class="row-del" data-id="${t.id}">✕</button>
      </div>`).join("");
    el.querySelectorAll(".row-del").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        templateTasks = templateTasks.filter(t=>t.id!==btn.getAttribute("data-id"));
        await setJSON(TASKS_KEY, templateTasks);
        renderTemplate();
      });
    });
  }
  document.getElementById("addTaskBtn").addEventListener("click", async ()=>{
    const section = document.getElementById("newTaskSection").value;
    const text = document.getElementById("newTaskInput").value.trim();
    if(!text) return;
    const newTask = { id: uid(), section, text };
    templateTasks.push(newTask);
    await setJSON(TASKS_KEY, templateTasks);
    document.getElementById("newTaskInput").value = "";
    renderTemplate();
    if(!dayData.locked){ dayData.items.push(itemFromTemplate(newTask)); await saveDay(); renderChecklist(); }
  });

  // ---------- DOCS ----------
  function renderDocFilters(){
    const el = document.getElementById("docFilters");
    const cats = ["Todos", ...DOC_CATS];
    el.innerHTML = cats.map(c => `<div class="filter-pill ${docFilter===c?'active':''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</div>`).join("");
    el.querySelectorAll(".filter-pill").forEach(p=>{
      p.addEventListener("click", ()=>{ docFilter = p.getAttribute("data-cat"); renderDocFilters(); renderDocs(); });
    });
  }
  function renderDocs(){
    const el = document.getElementById("docsList");
    const filtered = docs.filter(d => docFilter==="Todos" || (d.category||"Otro")===docFilter);
    if(!filtered.length){ el.innerHTML = `<div class="empty"><div class="e-ic">📄</div><p>Aún no hay documentos en esta categoría.</p></div>`; return; }
    const sorted = [...filtered].sort((a,b)=> b.updatedAt.localeCompare(a.updatedAt));
    el.innerHTML = sorted.map(d => `
      <div class="item-card">
        <div class="item-head">
          <div class="item-title">${escapeHtml(d.title)}</div>
          <button class="item-del" data-id="${d.id}">✕</button>
        </div>
        <div class="item-tag">${escapeHtml(d.category||"Otro")}</div>
        <div class="item-body">${escapeHtml(d.body)}</div>
      </div>`).join("");
    el.querySelectorAll(".item-del").forEach(btn=>{
      btn.addEventListener("click", async ()=>{ docs = docs.filter(d=>d.id!==btn.getAttribute("data-id")); await setJSON(DOCS_KEY, docs); renderDocs(); renderInicio(); });
    });
  }
  document.getElementById("addDocBtn").addEventListener("click", async ()=>{
    const category = document.getElementById("docCategory").value;
    const title = document.getElementById("docTitle").value.trim();
    const body = document.getElementById("docBody").value.trim();
    if(!title || !body) return;
    docs.push({ id:uid(), category, title, body, updatedAt:new Date().toISOString() });
    await setJSON(DOCS_KEY, docs);
    document.getElementById("docTitle").value=""; document.getElementById("docBody").value="";
    renderDocs();
  });

  // ---------- CALENDARIO ----------
  function renderCalendar(){
    document.getElementById("calTitle").textContent = new Intl.DateTimeFormat("es-ES",{month:"long", year:"numeric"}).format(calViewMonth);
    const grid = document.getElementById("calGrid");
    const dows = ["D","L","M","M","J","V","S"];
    let html = dows.map(d=>`<div class="cal-dow">${d}</div>`).join("");
    const firstDow = calViewMonth.getDay();
    const startDate = new Date(calViewMonth); startDate.setDate(startDate.getDate() - firstDow);
    const eventDates = new Set(events.map(e=>e.date));
    for(let i=0;i<42;i++){
      const d = new Date(startDate); d.setDate(startDate.getDate()+i);
      const inMonth = d.getMonth()===calViewMonth.getMonth();
      const iso = isoLocal(d);
      const isToday = iso===isoLocal(today);
      const isSel = iso===isoLocal(calSelected);
      const hasEv = eventDates.has(iso);
      html += `<div class="cal-day ${inMonth?'':'muted'} ${isToday?'today':''} ${isSel?'selected':''} ${hasEv?'has-event':''}" data-iso="${iso}">${d.getDate()}</div>`;
      if(i>=34 && d.getMonth()!==calViewMonth.getMonth() && (i+1)%7===0) break;
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".cal-day:not(.muted)").forEach(cell=>{
      cell.addEventListener("click", ()=>{
        const [y,m,dd] = cell.getAttribute("data-iso").split("-").map(Number);
        calSelected = new Date(y,m-1,dd);
        renderCalendar(); renderDayDetail();
      });
    });
  }
  document.getElementById("prevMonth").addEventListener("click", ()=>{ calViewMonth = new Date(calViewMonth.getFullYear(), calViewMonth.getMonth()-1, 1); renderCalendar(); });
  document.getElementById("nextMonth").addEventListener("click", ()=>{ calViewMonth = new Date(calViewMonth.getFullYear(), calViewMonth.getMonth()+1, 1); renderCalendar(); });

  function renderDayDetail(){
    document.getElementById("dayDetailTitle").textContent = fmtDateLong(calSelected);
    const iso = isoLocal(calSelected);
    const el = document.getElementById("dayDetailList");
    const dayEvents = events.filter(e=>e.date===iso).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
    if(!dayEvents.length){ el.innerHTML = `<div class="empty" style="padding:18px 4px;"><p>Nada programado este día.</p></div>`; return; }
    el.innerHTML = dayEvents.map(ev => `
      <div class="item-card">
        <div class="item-head">
          <div><div class="item-title">${escapeHtml(ev.title)}</div>${ev.time?`<div class="item-meta">${ev.time}</div>`:""}</div>
          <button class="item-del" data-id="${ev.id}">✕</button>
        </div>
        ${ev.notes?`<div class="item-body">${escapeHtml(ev.notes)}</div>`:""}
      </div>`).join("");
    el.querySelectorAll(".item-del").forEach(btn=>{
      btn.addEventListener("click", async ()=>{ events = events.filter(e=>e.id!==btn.getAttribute("data-id")); await setJSON(EVENTS_KEY, events); renderCalendar(); renderDayDetail(); renderInicio(); });
    });
  }
  document.getElementById("addEventBtn").addEventListener("click", async ()=>{
    const date = document.getElementById("evDate").value || isoLocal(calSelected);
    const time = document.getElementById("evTime").value;
    const title = document.getElementById("evTitle").value.trim();
    const notes = document.getElementById("evNotes").value.trim();
    if(!date || !title) return;
    events.push({ id:uid(), date, time, title, notes });
    await setJSON(EVENTS_KEY, events);
    document.getElementById("evDate").value=""; document.getElementById("evTime").value="";
    document.getElementById("evTitle").value=""; document.getElementById("evNotes").value="";
    document.getElementById("eventFormBg").classList.add("hidden");
    const [y,m,dd]=date.split("-").map(Number); calSelected=new Date(y,m-1,dd);
    renderCalendar(); renderDayDetail(); renderInicio();
  });

  // ---------- RECETAS ----------
  let recFilter = "Todos";
  function renderRecFilters(){
    const el = document.getElementById("recFilters");
    const cats = ["Todos", ...REC_CATS];
    el.innerHTML = cats.map(c => `<div class="filter-pill ${recFilter===c?'active':''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</div>`).join("");
    el.querySelectorAll(".filter-pill").forEach(p=>{
      p.addEventListener("click", ()=>{ recFilter = p.getAttribute("data-cat"); renderRecFilters(); renderRecetas(); });
    });
  }
  const MAX_EDITS = 3;
  const RATING_EMOJI = { love:"😍", ok:"😐", dislike:"😖" };
  const RATING_LABEL = { love:"Le encantó", ok:"Más o menos", dislike:"No le gustó" };
  let expandedRecipes = new Set();
  function renderRecetas(){
    const el = document.getElementById("recetasList");
    const filtered = recipes.filter(r => recFilter==="Todos" || (r.category||"Res")===recFilter);
    if(!filtered.length){ el.innerHTML = `<div class="empty"><div class="e-ic">🍽️</div><p>Aún no hay recetas guardadas en esta categoría.</p></div>`; return; }
    const sorted = [...filtered].sort((a,b)=> b.updatedAt.localeCompare(a.updatedAt));
    el.innerHTML = sorted.map(r => {
      const isOpen = expandedRecipes.has(r.id);
      const editCount = r.editCount || 0;
      const maxedOut = editCount >= MAX_EDITS;
      return `
      <div class="item-card rec-card" data-id="${r.id}">
        <div class="item-head rec-head" data-id="${r.id}" style="cursor:pointer;">
          <div>
            <div class="item-title">${escapeHtml(r.name)}</div>
            <div class="item-tag">${escapeHtml(r.category||"Res")}</div>
            ${r.ageRec?`<div class="item-meta" style="margin-top:4px;">${escapeHtml(r.ageRec)}</div>`:""}
            ${editCount>0 ? `<div class="edit-count-badge">Editada ${editCount}/${MAX_EDITS}</div>` : ""}
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${r.rating ? `<span class="rating-face" title="Calificación">${RATING_EMOJI[r.rating]}</span>` : ""}
            <span class="rec-chevron" style="color:var(--ink-soft); font-size:13px; transform:rotate(${isOpen?90:0}deg); transition:transform 0.15s ease; display:inline-block;">›</span>
            <button class="item-edit ${maxedOut?'maxed':''}" data-id="${r.id}" title="${maxedOut?'Límite de ediciones alcanzado':'Editar'}">✏️</button>
            ${role==="padres" ? `<button class="item-del" data-id="${r.id}">✕</button>` : ""}
          </div>
        </div>
        <div class="rec-details" style="display:${isOpen?'block':'none'};">
          ${r.ingredients?`<div class="item-meta" style="margin-top:8px;">INGREDIENTES</div><div class="item-body">${escapeHtml(r.ingredients)}</div>`:""}
          ${r.steps?`<div class="item-meta" style="margin-top:8px;">PREPARACIÓN</div><div class="item-body">${escapeHtml(r.steps)}</div>`:""}
          ${r.notes?`<div class="item-meta" style="margin-top:8px;">NOTAS</div><div class="item-body">${escapeHtml(r.notes)}</div>`:""}
          <div class="item-meta" style="margin-top:10px;">¿QUÉ LE PARECIÓ A AMIR? 💙</div>
          <div class="rating-row" data-id="${r.id}">
            ${Object.keys(RATING_EMOJI).map(key=>`
              <button type="button" class="rating-btn ${r.rating===key?'active':''}" data-id="${r.id}" data-rating="${key}">
                <span class="rf">${RATING_EMOJI[key]}</span><span class="rl">${RATING_LABEL[key]}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>`;
    }).join("");
    el.querySelectorAll(".rating-btn").forEach(btn=>{
      btn.addEventListener("click", async (e)=>{
        e.stopPropagation();
        const r = recipes.find(x=>x.id===btn.getAttribute("data-id"));
        const val = btn.getAttribute("data-rating");
        r.rating = (r.rating === val) ? null : val; // tap again to clear
        await setJSON(RECIPES_KEY, recipes);
        renderRecetas();
      });
    });
    el.querySelectorAll(".rec-head").forEach(head=>{
      head.addEventListener("click", (e)=>{
        if(e.target.closest(".item-del") || e.target.closest(".item-edit")) return;
        const id = head.getAttribute("data-id");
        if(expandedRecipes.has(id)) expandedRecipes.delete(id); else expandedRecipes.add(id);
        renderRecetas();
      });
    });
    el.querySelectorAll(".item-del").forEach(btn=>{
      btn.addEventListener("click", async (e)=>{
        e.stopPropagation();
        recipes = recipes.filter(r=>r.id!==btn.getAttribute("data-id"));
        await setJSON(RECIPES_KEY, recipes); renderRecetas();
      });
    });
    el.querySelectorAll(".item-edit").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const r = recipes.find(x=>x.id===id);
        if(r && (r.editCount||0) >= MAX_EDITS){
          alert("Esta receta ya alcanzó el máximo de "+MAX_EDITS+" ediciones.");
          return;
        }
        openRecipeForEdit(id);
      });
    });
  }

  let editingRecipeId = null;
  function openRecipeForEdit(id){
    const r = recipes.find(x=>x.id===id);
    if(!r) return;
    editingRecipeId = id;
    document.getElementById("recFormTitle").textContent = "Editar receta";
    document.getElementById("recCategory").value = r.category || "Res";
    document.getElementById("recName").value = r.name || "";
    document.getElementById("recAge").value = r.ageRec || "";
    document.getElementById("recIng").value = r.ingredients || "";
    document.getElementById("recSteps").value = r.steps || "";
    document.getElementById("recNotes").value = r.notes || "";
    const remaining = MAX_EDITS - (r.editCount||0);
    document.getElementById("addRecBtn").textContent = `Guardar cambios (te quedan ${remaining} ${remaining===1?'edición':'ediciones'})`;
    document.getElementById("recFormBg").classList.remove("hidden");
  }
  function resetRecipeForm(){
    editingRecipeId = null;
    document.getElementById("recFormTitle").textContent = "Nueva receta";
    document.getElementById("addRecBtn").textContent = "Guardar receta";
    ["recName","recAge","recIng","recSteps","recNotes"].forEach(id=> document.getElementById(id).value="");
    document.getElementById("recCategory").value = "Desayunos";
  }
  document.getElementById("toggleRecForm").addEventListener("click", resetRecipeForm);
  document.getElementById("closeRecForm").addEventListener("click", resetRecipeForm);

  document.getElementById("addRecBtn").addEventListener("click", async ()=>{
    const category = document.getElementById("recCategory").value;
    const name = document.getElementById("recName").value.trim();
    const ageRec = document.getElementById("recAge").value.trim();
    const ingredients = document.getElementById("recIng").value.trim();
    const steps = document.getElementById("recSteps").value.trim();
    const notes = document.getElementById("recNotes").value.trim();
    if(!name) return;
    if(editingRecipeId){
      const r = recipes.find(x=>x.id===editingRecipeId);
      if(r){
        if((r.editCount||0) >= MAX_EDITS){
          alert("Esta receta ya alcanzó el máximo de "+MAX_EDITS+" ediciones.");
          resetRecipeForm();
          document.getElementById("recFormBg").classList.add("hidden");
          renderRecetas();
          return;
        }
        r.category = category; r.name = name; r.ageRec = ageRec;
        r.ingredients = ingredients; r.steps = steps; r.notes = notes;
        r.editCount = (r.editCount||0) + 1;
        r.updatedAt = new Date().toISOString();
      }
    } else {
      recipes.push({ id:uid(), category, name, ageRec, ingredients, steps, notes, editCount:0, updatedAt:new Date().toISOString() });
    }
    await setJSON(RECIPES_KEY, recipes);
    resetRecipeForm();
    document.getElementById("recFormBg").classList.add("hidden");
    renderRecetas();
  });

  // ---------- LIBRES ----------
  let libreCategory = "vacacion";
  let libreType = "completo";
  const libCategoryRow = document.getElementById("libCategoryRow");
  if(libCategoryRow){
    libCategoryRow.querySelectorAll(".pill-opt").forEach(p=>{
      p.addEventListener("click", ()=>{
        libCategoryRow.querySelectorAll(".pill-opt").forEach(x=>x.classList.remove("active"));
        p.classList.add("active");
        libreCategory = p.getAttribute("data-val");
        const isVac = libreCategory === "vacacion";
        document.getElementById("vacTypeOuter").style.display = isVac ? "block" : "none";
        if(!isVac){
          // Holidays / Días Extras always use a simple date range, no Completo/Parcial split
          document.getElementById("libCompletoFields").style.display = "block";
          document.getElementById("libParcialFields").style.display = "none";
        } else {
          document.getElementById("libCompletoFields").style.display = libreType==="completo" ? "block" : "none";
          document.getElementById("libParcialFields").style.display = libreType==="parcial" ? "block" : "none";
        }
      });
    });
  }
  const libTypeRow = document.getElementById("libTypeRow");
  if(libTypeRow){
    libTypeRow.querySelectorAll(".pill-opt").forEach(p=>{
      p.addEventListener("click", ()=>{
        libTypeRow.querySelectorAll(".pill-opt").forEach(x=>x.classList.remove("active"));
        p.classList.add("active");
        libreType = p.getAttribute("data-val");
        document.getElementById("libCompletoFields").style.display = libreType==="completo" ? "block" : "none";
        document.getElementById("libParcialFields").style.display = libreType==="parcial" ? "block" : "none";
      });
    });
  }
  function countWeekdays(startIso, endIso){
    const [sy,sm,sd] = startIso.split("-").map(Number);
    const [ey,em,ed] = endIso.split("-").map(Number);
    let d = new Date(sy, sm-1, sd);
    const end = new Date(ey, em-1, ed);
    let count = 0;
    while(d <= end){
      const dow = d.getDay();
      if(dow>=1 && dow<=5) count++;
      d.setDate(d.getDate()+1);
    }
    return count;
  }
  function libreDayFraction(l){
    if(l.type === "parcial"){
      if(l.horaEntrada && l.horaSalida){
        const [eh,em] = l.horaEntrada.split(":").map(Number);
        const [sh,sm] = l.horaSalida.split(":").map(Number);
        const mins = Math.abs((sh*60+sm) - (eh*60+em));
        return Math.min(1, mins/60/8);
      }
      return 0.5; // only one time given — estimate half day
    }
    return countWeekdays(l.startDate, l.endDate);
  }
  function renderBalance(){
    const yearNow = today.getFullYear();
    const isVacacion = l => (l.category || "vacacion") === "vacacion";
    const inThisYear = l => {
      const d = l.type==="parcial" ? l.date : l.startDate;
      return d && new Date(d).getFullYear() === yearNow;
    };
    const vacaciones = libres.filter(l=> isVacacion(l) && inThisYear(l));
    const aprobados = vacaciones.filter(l=> l.status==="aprobado");
    const pendientes = vacaciones.filter(l=> l.status==="pendiente");
    const usedDays = aprobados.reduce((s,l)=> s+libreDayFraction(l), 0);
    const pendingDays = pendientes.reduce((s,l)=> s+libreDayFraction(l), 0);
    const available = Math.max(0, ANNUAL_PAID_DAYS - usedDays);
    document.getElementById("balanceNum").textContent = `${Math.round(available*10)/10}/${ANNUAL_PAID_DAYS}`;
    document.getElementById("balanceFill").style.width = `${Math.min(100,(usedDays/ANNUAL_PAID_DAYS)*100)}%`;

    const holidaysThisYear = libres.filter(l=> (l.category==="holiday" || l.category==="dia_extra") && inThisYear(l));
    const holidayDays = holidaysThisYear.reduce((s,l)=> s+countWeekdays(l.startDate,l.endDate), 0);
    document.getElementById("balanceDetail").textContent =
      `Tiempo Libre usado: ${Math.round(usedDays*10)/10} días · Pendientes: ${Math.round(pendingDays*10)/10} días (no descontados) · Holidays/Días Extras aparte: ${holidayDays} días · Año ${yearNow}`;
  }
  function renderBonus2(){
    getJSON(BONUS_KEY, {given:false}).then(b=>{
      const pill = document.getElementById("bonus2Status");
      if(!pill) return;
      pill.textContent = b.given ? "Entregado" : "Pendiente";
      pill.className = "status-pill " + (b.given ? "aprobado" : "pendiente");
      pill.style.cursor = role==="padres" ? "pointer" : "default";
      pill.onclick = role==="padres" ? async ()=>{
        const nb = { given: !b.given };
        await setJSON(BONUS_KEY, nb);
        renderBonus2();
      } : null;
    });
  }

  function renderLibreCard(l){
    let dateLine, timeLine = "";
    if(l.type === "parcial"){
      dateLine = fmtDateShort(l.date);
      const parts = [];
      if(l.horaEntrada) parts.push("Entrada "+fmtTime12(l.horaEntrada));
      if(l.horaSalida) parts.push("Salida "+fmtTime12(l.horaSalida));
      timeLine = parts.join(" · ");
    } else {
      dateLine = fmtDateShort(l.startDate) + (l.endDate && l.endDate!==l.startDate ? " – "+fmtDateShort(l.endDate) : "");
    }
    let tag, tagClass;
    if(l.category === "holiday"){ tag = "Holidays"; tagClass = "tag-holiday"; }
    else if(l.category === "dia_extra"){ tag = "Días Extras"; tagClass = "tag-extra"; }
    else { tag = l.type==="parcial" ? "Parcial" : "Completo"; tagClass = "tag-vacacion"; }
    return `
      <div class="item-card">
        <div class="item-head">
          <div>
            <div class="item-title">${dateLine}</div>
            <div class="item-tag ${tagClass}">${tag}</div>
            ${timeLine ? `<div class="item-meta" style="margin-top:6px;">${escapeHtml(timeLine)}</div>` : ""}
            ${l.reason?`<div class="item-meta" style="margin-top:4px;">${escapeHtml(l.reason)}</div>`:""}
          </div>
          <span class="status-pill ${l.status}">${l.status}</span>
        </div>
        ${role==="padres" && l.status==="pendiente" ? `
          <div class="approve-row" data-id="${l.id}">
            <button class="apr" data-id="${l.id}" data-act="aprobado">Aprobar</button>
            <button class="rej" data-id="${l.id}" data-act="rechazado">Rechazar</button>
          </div>` : ""}
        ${role==="padres" ? `
          <div class="edit-del-row">
            <button class="lib-edit" data-id="${l.id}">✏️ Editar</button>
            <button class="lib-del" data-id="${l.id}">✕ Eliminar</button>
          </div>` : ""}
      </div>`;
  }

  let openYears = new Set([today.getFullYear()]);
  function renderLibres(){
    renderBalance();
    renderBonus2();

    const libreDate = l => l.type === "parcial" ? l.date : l.startDate;
    const el = document.getElementById("libresList");
    const groups = [
      { key:"vacacion", title:"🏖️ Tiempo Libre", cls:"grp-vacacion", empty:"Aún no hay solicitudes de Tiempo Libre." },
      { key:"holiday",  title:"🎉 Holidays",      cls:"grp-holiday",  empty:"Aún no hay Holidays registrados." },
      { key:"dia_extra",title:"🎁 Días Extras",   cls:"grp-extra",    empty:"Aún no hay Días Extras registrados." },
    ];

    const byYear = {};
    libres.forEach(l=>{
      const y = new Date(libreDate(l)).getFullYear();
      if(!byYear[y]) byYear[y] = [];
      byYear[y].push(l);
    });
    const years = Object.keys(byYear).map(Number);
    if(!years.includes(today.getFullYear())) years.push(today.getFullYear());
    years.sort((a,b)=> b-a); // most recent year first

    el.innerHTML = years.map(y=>{
      const isOpen = openYears.has(y);
      const yearItems = byYear[y] || [];
      const groupsHtml = groups.map(g=>{
        const items = yearItems.filter(l => (l.category||"vacacion") === g.key)
                                .sort((a,b)=> libreDate(a).localeCompare(libreDate(b)));
        const body = items.length
          ? items.map(renderLibreCard).join("")
          : `<div class="empty" style="padding:16px 4px;"><p>${g.empty}</p></div>`;
        return `<div class="libre-group ${g.cls}"><div class="sec-heading libre-group-heading">${g.title}</div>${body}</div>`;
      }).join("");
      return `
        <div class="year-toggle" data-year="${y}">
          <span class="yt-title">Solicitudes ${y}</span>
          <span class="yt-chevron ${isOpen?'open':''}">›</span>
        </div>
        <div class="year-body" data-year-body="${y}" style="display:${isOpen?'block':'none'};">${groupsHtml}</div>
      `;
    }).join("");

    el.querySelectorAll(".year-toggle").forEach(row=>{
      row.addEventListener("click", ()=>{
        const y = Number(row.getAttribute("data-year"));
        if(openYears.has(y)) openYears.delete(y); else openYears.add(y);
        renderLibres();
      });
    });
    el.querySelectorAll(".approve-row button").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const l = libres.find(x=>x.id===btn.getAttribute("data-id"));
        l.status = btn.getAttribute("data-act");
        await setJSON(LIBRES_KEY, libres);
        renderLibres(); renderInicio();
      });
    });
    el.querySelectorAll(".lib-edit").forEach(btn=>{
      btn.addEventListener("click", ()=> openLibreForEdit(btn.getAttribute("data-id")));
    });
    el.querySelectorAll(".lib-del").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        libres = libres.filter(l=>l.id !== btn.getAttribute("data-id"));
        await setJSON(LIBRES_KEY, libres);
        renderLibres(); renderInicio();
      });
    });
  }

  let editingLibreId = null;
  function setCategoryPill(val){
    libCategoryRow.querySelectorAll(".pill-opt").forEach(x=> x.classList.toggle("active", x.getAttribute("data-val")===val));
    libreCategory = val;
    const isVac = val === "vacacion";
    document.getElementById("vacTypeOuter").style.display = isVac ? "block" : "none";
  }
  function setTypePill(val){
    libTypeRow.querySelectorAll(".pill-opt").forEach(x=> x.classList.toggle("active", x.getAttribute("data-val")===val));
    libreType = val;
    document.getElementById("libCompletoFields").style.display = val==="completo" ? "block" : "none";
    document.getElementById("libParcialFields").style.display = val==="parcial" ? "block" : "none";
  }
  function openLibreForEdit(id){
    const l = libres.find(x=>x.id===id);
    if(!l) return;
    editingLibreId = id;
    document.querySelector("#libreFormBg .form-modal-head h3").textContent = "Editar tiempo libre";
    setCategoryPill(l.category || "vacacion");
    if((l.category||"vacacion")==="vacacion"){
      setTypePill(l.type || "completo");
    } else {
      document.getElementById("libCompletoFields").style.display = "block";
      document.getElementById("libParcialFields").style.display = "none";
    }
    if(l.type === "parcial" && (l.category||"vacacion")==="vacacion"){
      document.getElementById("libDate").value = l.date || "";
      document.getElementById("libHoraEntrada").value = l.horaEntrada || "";
      document.getElementById("libHoraSalida").value = l.horaSalida || "";
    } else {
      document.getElementById("libStart").value = l.startDate || "";
      document.getElementById("libEnd").value = l.endDate || "";
    }
    document.getElementById("libReason").value = l.reason || "";
    document.getElementById("addLibreBtn").textContent = "Guardar cambios";
    document.getElementById("libreFormBg").classList.remove("hidden");
  }
  function resetLibreForm(){
    editingLibreId = null;
    document.querySelector("#libreFormBg .form-modal-head h3").textContent = "Solicitar tiempo libre";
    document.getElementById("addLibreBtn").textContent = "Enviar solicitud";
    setCategoryPill("vacacion");
    setTypePill("completo");
    ["libStart","libEnd","libDate","libHoraSalida","libHoraEntrada","libReason"].forEach(id=> document.getElementById(id).value="");
  }
  document.getElementById("toggleLibreForm").addEventListener("click", resetLibreForm);
  document.getElementById("closeLibreForm").addEventListener("click", resetLibreForm);

  document.getElementById("addLibreBtn").addEventListener("click", async ()=>{
    const reason = document.getElementById("libReason").value.trim();
    const autoApproved = libreCategory !== "vacacion"; // Holidays / Días Extras are granted directly, no approval needed
    let entry = { id: editingLibreId || uid(), category:libreCategory, reason, createdAt:new Date().toISOString() };
    if(editingLibreId){
      const existing = libres.find(x=>x.id===editingLibreId);
      entry.status = existing ? existing.status : (autoApproved ? "aprobado" : "pendiente");
      entry.createdAt = existing ? existing.createdAt : entry.createdAt;
    } else {
      entry.status = autoApproved ? "aprobado" : "pendiente";
    }
    if(libreCategory === "vacacion" && libreType === "parcial"){
      entry.type = "parcial";
      const date = document.getElementById("libDate").value;
      const horaSalida = document.getElementById("libHoraSalida").value;
      const horaEntrada = document.getElementById("libHoraEntrada").value;
      if(!date) return;
      if(!horaSalida && !horaEntrada) return; // needs at least one time
      entry.date = date; entry.horaSalida = horaSalida; entry.horaEntrada = horaEntrada;
    } else {
      entry.type = "completo";
      const startDate = document.getElementById("libStart").value;
      const endDate = document.getElementById("libEnd").value || startDate;
      if(!startDate) return;
      entry.startDate = startDate; entry.endDate = endDate;
    }
    if(editingLibreId){
      const idx = libres.findIndex(x=>x.id===editingLibreId);
      if(idx >= 0) libres[idx] = entry;
    } else {
      libres.push(entry);
    }
    await setJSON(LIBRES_KEY, libres);
    resetLibreForm();
    document.getElementById("libreFormBg").classList.add("hidden");
    renderLibres(); renderInicio();
  });

  // ---------- INICIO / BIENVENIDA ----------
  async function renderInicio(){
    document.getElementById("greetText").textContent = role==="niñera" ? "¡Bienvenida, Dayris! 👋" : "¡Bienvenidos! 👋";
    document.getElementById("greetDate").textContent = fmtDateLong(today);

    const remindersEl = document.getElementById("reminders");
    let cards = "";

    if(isCookingDay(today)){
      cards += `<div class="reminder-card cook"><span class="ric">🍲</span><div><b>Hoy toca cocinar</b><span class="sub">Prepara 2 recetas para Amir (lunes y jueves)</span></div></div>`;
    }

    const todayIso = isoLocal(today);
    const todayEvents = events.filter(e=>e.date===todayIso).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
    todayEvents.forEach(ev=>{
      cards += `<div class="reminder-card event"><span class="ric">📅</span><div><b>${escapeHtml(ev.title)}</b><span class="sub">Hoy${ev.time?" a las "+ev.time:""}</span></div></div>`;
    });

    const in7 = new Date(today); in7.setDate(in7.getDate()+7);
    const upcoming = events.filter(e=>{
      const [y,m,d] = e.date.split("-").map(Number); const ed = new Date(y,m-1,d);
      return ed > today && ed <= in7;
    }).sort((a,b)=> a.date.localeCompare(b.date)).slice(0,3);
    upcoming.forEach(ev=>{
      cards += `<div class="reminder-card event"><span class="ric">📅</span><div><b>${escapeHtml(ev.title)}</b><span class="sub">${fmtDateShort(ev.date)}${ev.time?" · "+ev.time:""}</span></div></div>`;
    });

    if(!cards) cards = `<div class="empty" style="padding:14px 4px;"><p>No hay recordatorios por ahora. ¡Buen día! 🌤️</p></div>`;
    remindersEl.innerHTML = cards;

    const todayDay = await getJSON(DAY_PREFIX + todayIso, null);
    const totalTasks = todayDay ? todayDay.items.length : templateTasks.length;
    const doneTasks = todayDay ? todayDay.items.filter(i=>i.done).length : 0;
    const pendingLibres = libres.filter(l=>l.status==="pendiente").length;

    document.getElementById("dashStats").innerHTML = `
      <div class="stat-mini"><span class="smi">📋</span><span class="smt">Checklist de hoy</span><span class="smv">${doneTasks}/${totalTasks}</span></div>
      <div class="stat-mini"><span class="smi">📄</span><span class="smt">Documentos guardados</span><span class="smv">${docs.length}</span></div>
      <div class="stat-mini"><span class="smi">🍽️</span><span class="smt">Recetas guardadas</span><span class="smv">${recipes.length}</span></div>
      <div class="stat-mini"><span class="smi">🌴</span><span class="smt">Solicitudes pendientes</span><span class="smv">${pendingLibres}</span></div>
    `;
  }

  // ---------- INIT ----------
  function waitForStorage(timeoutMs){
    return new Promise(resolve=>{
      const start = Date.now();
      (function check(){
        if(typeof window.storage !== "undefined" && window.storage){ resolve(true); return; }
        if(Date.now() - start > timeoutMs){ resolve(false); return; }
        setTimeout(check, 150);
      })();
    });
  }

  // ---------- MANUAL BACKUP (always works, no dependency on window.storage) ----------
  function collectState(){
    return { templateTasks, docs, events, recipes, libres, dayIso: isoLocal(currentDate), day: dayData, savedAt: new Date().toISOString() };
  }
  function applyState(obj){
    if(obj.templateTasks) templateTasks = obj.templateTasks;
    if(obj.docs) docs = obj.docs;
    if(obj.events) events = obj.events;
    if(obj.recipes) recipes = obj.recipes;
    if(obj.libres) libres = obj.libres;
    if(obj.day) dayData = obj.day;
    renderDocFilters(); renderDocs();
    renderCalendar(); renderDayDetail();
    renderRecetas(); renderLibres();
    renderHeaderNav(); renderChecklist();
    renderInicio();
    // best-effort: also try to push into shared storage in case it's working now
    setJSON(TASKS_KEY, templateTasks, true);
    setJSON(DOCS_KEY, docs, true);
    setJSON(EVENTS_KEY, events, true);
    setJSON(RECIPES_KEY, recipes, true);
    setJSON(LIBRES_KEY, libres, true);
    saveDay();
  }
  function copyTextFallback(text){
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try{ document.execCommand("copy"); }catch(e){}
    document.body.removeChild(ta);
  }
  document.getElementById("copyBackupBtn").addEventListener("click", async ()=>{
    const text = JSON.stringify(collectState());
    const file = new File([text], "nido-respaldo.json", { type: "application/json" });
    try{
      if(navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({ files:[file], title:"Respaldo Nido" });
        const msg = document.getElementById("backupMsg");
        msg.style.display = "block";
        setTimeout(()=> msg.style.display="none", 4000);
        return;
      }
    }catch(e){
      if(e && e.name === "AbortError") return;
    }
    try{ await navigator.clipboard.writeText(text); }
    catch(e){ copyTextFallback(text); }
    const msg = document.getElementById("backupMsg");
    msg.style.display = "block";
    setTimeout(()=> msg.style.display="none", 4000);
  });
  document.getElementById("restoreBackupBtn").addEventListener("click", ()=>{
    const raw = document.getElementById("backupPaste").value.trim();
    if(!raw) return;
    try{
      const obj = JSON.parse(raw);
      applyState(obj);
      document.getElementById("backupPaste").value = "";
      alert("Respaldo restaurado.");
    }catch(e){
      alert("Ese texto no es un respaldo válido. Verifica que lo copiaste completo.");
    }
  });
  document.getElementById("restoreFileInput").addEventListener("change", async (e)=>{
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if(!file) return;
    try{
      const obj = JSON.parse(await file.text());
      applyState(obj);
      alert("Respaldo restaurado.");
    }catch(err){
      alert("Ese archivo no es un respaldo válido.");
    }
  });

  async function init(){
    const ready = await waitForStorage(3000);
    if(!ready){
      showError(true, "El guardado automático no está disponible ahora mismo. La app sigue funcionando, pero usa \"Compartir o copiar respaldo\" en Inicio antes de cerrarla.");
    } else {
      await storageSelfTest();
      // real round-trip check: write a marker, then re-read it back
      const marker = "check-"+Date.now();
      await setJSON("amir:_marker", {v:marker}, true);
      const readBack = await getJSON("amir:_marker", null);
      if(readBack && readBack.v === marker){
        updateDiag({result:"✅ Confirmado (guardar y leer funcionan)", detail:"Tus datos deberían persistir al cerrar y reabrir la app."});
      } else {
        updateDiag({result:"⚠️ Guardó pero no pudo releer", detail:"El guardado parece funcionar pero al releer no aparece el mismo dato — esto puede explicar por qué se pierde la información. Usa el respaldo manual."});
        showError(true, "El guardado no está persistiendo de forma confiable. Usa \"Compartir o copiar respaldo\" en Inicio antes de cerrar la app.");
      }
    }
    templateTasks = await getJSON(TASKS_KEY, null);
    if(templateTasks === null){ templateTasks = DEFAULT_TASKS; await setJSONRetry(TASKS_KEY, templateTasks); }
    else if(migrateTaskTexts(templateTasks)){ await setJSON(TASKS_KEY, templateTasks); }
    docs = await getJSON(DOCS_KEY, []);
    events = await getJSON(EVENTS_KEY, []);
    recipes = await getJSON(RECIPES_KEY, []);
    libres = await getJSON(LIBRES_KEY, []);

    await goToDay(new Date());
    renderDocFilters(); renderDocs();
    renderCalendar(); renderDayDetail();
    renderRecFilters(); renderRecetas();
    renderLibres();
    await renderInicio();
    const installCard = document.getElementById("iosInstallCard");
    if(installCard){
      const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
      if(!standalone) installCard.hidden = false;
    }
    document.getElementById("loadOverlay").classList.add("hidden");
  }

  document.addEventListener("focusin", (e)=>{
    if(e.target && e.target.matches && e.target.matches("input, textarea, select")){
      document.body.classList.add("kb-open");
    }
  });
  document.addEventListener("focusout", ()=>{
    setTimeout(()=>{
      const active = document.activeElement;
      if(!active || !active.matches || !active.matches("input, textarea, select")){
        document.body.classList.remove("kb-open");
      }
    }, 50);
  });

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{ /* offline cache is optional */ });
  }

  init();
})();
