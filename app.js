'use strict';

// WerkStandaard is een offline-first app. Ingevoerde gegevens blijven in IndexedDB
// op dit apparaat; er worden geen gegevens naar een backend verzonden.
const DB_NAME = 'werkstandaard-db';
const DB_VERSION = 1;
let database;
let tasks = [];
let activeId = null;
let editingId = null;
let currentView = 'home';
let toastTimer;
const $ = (id) => document.getElementById(id);
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const html = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const withBreaks = (value) => html(value).replace(/\n/g, '<br>');
const imageSource = (value) => typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value) ? value : '';
const sorted = () => [...tasks].sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
const getTask = (id) => tasks.find(item => item.id === id);
const byId = (arr, id) => arr.find(item => item.id === id);
const dateFormat = (iso) => { try { return new Date(iso).toLocaleDateString('nl-NL', {day:'numeric',month:'short',year:'numeric'}); } catch { return ''; } };

function showToast(message) {
  const toast = $('toast'); toast.textContent = message;
  toast.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3400);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('tasks')) request.result.createObjectStore('tasks', {keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Opslag niet beschikbaar'));
  });
}
function allRecords() {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tasks', 'readonly');
    const req = tx.objectStore('tasks').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function putRecord(task) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tasks', 'readwrite');
    tx.objectStore('tasks').put(task);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function deleteRecord(id) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tasks', 'readwrite');
    tx.objectStore('tasks').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function saveTask(task, {touch=true}={}) {
  if (touch) task.updatedAt = new Date().toISOString();
  await putRecord(task);
  const index = tasks.findIndex(t => t.id === task.id);
  if (index >= 0) tasks[index] = task; else tasks.push(task);
}
function initialDemo() {
  return {
    id:uuid(), title:'DEMO — Visuele inspectie', machine:'Voorbeeldinstallatie', category:'Inspectie',
    frequency:'Voorbeeld: wekelijks', tools:'Vul hier de goedgekeurde middelen en hulpmiddelen in.',
    safety:'DEMO: dit is geen volledige werkinstructie. Volg altijd de goedgekeurde procedures, vereiste bevoegdheden en veiligheidsmaatregelen voor jouw installatie.',
    steps:[
      {id:uuid(),text:'Open en controleer de actuele, goedgekeurde werkinstructie voor deze installatie.'},
      {id:uuid(),text:'Leg volgens die instructie relevante observaties en foto’s vast.'},
      {id:uuid(),text:'Registreer eventuele afwijkingen volgens de procedure van jouw organisatie.'}
    ],
    checks:[
      {id:uuid(),text:'Juiste, goedgekeurde instructie geraadpleegd',done:false},
      {id:uuid(),text:'Visuele observaties vastgelegd',done:false},
      {id:uuid(),text:'Eventuele afwijkingen gemeld',done:false}
    ],
    photos:[],updatedAt:new Date().toISOString()
  };
}
function showView(view) {
  currentView = view;
  $('homeView').classList.toggle('hidden', view !== 'home');
  $('detailView').classList.toggle('hidden', view !== 'detail');
  $('backupView').classList.toggle('hidden', view !== 'backup');
  $('navHome').classList.toggle('active', view === 'home' || view === 'detail');
  $('navBackup').classList.toggle('active', view === 'backup');
  if (view === 'home') renderHome();
  if (view === 'detail') renderDetail();
  if (view === 'backup') renderBackup();
  window.scrollTo({top:0,behavior:'auto'});
}
function openTask(id) { activeId = id; showView('detail'); }
function progress(task) {
  const done = (task.checks || []).filter(c => c.done).length;
  const total = (task.checks || []).length;
  return {done,total,pct:total ? Math.round(done/total*100) : 0};
}
function renderHome() {
  $('statTasks').textContent = tasks.length;
  $('statPhotos').textContent = tasks.reduce((n,t) => n + (t.photos || []).length, 0);
  $('statChecks').textContent = tasks.reduce((n,t) => n + (t.checks || []).length, 0);
  const query = $('searchInput').value.trim().toLocaleLowerCase('nl');
  const category = $('categoryFilter').value;
  const matching = sorted().filter(t => (!category || t.category === category) &&
      [t.title,t.machine,t.category,t.frequency,t.tools,...(t.steps || []).map(s => s.text)].join(' ').toLocaleLowerCase('nl').includes(query));
  if (!matching.length) {
    $('taskList').innerHTML = `<div class="empty"><div class="empty-illustration">${tasks.length ? '⌕' : '🗂️'}</div><h3>${tasks.length ? 'Geen taken gevonden' : 'Je bibliotheek is nog leeg'}</h3><p>${tasks.length ? 'Pas je zoekopdracht of filter aan.' : 'Voeg je eerste onderhoudstaak toe om te beginnen.'}</p><button type="button" class="button button-primary" data-action="new">＋ Nieuwe taak</button></div>`;
    return;
  }
  $('taskList').innerHTML = matching.map(t => {
    const p = progress(t);
    return `<button type="button" class="task-card" data-open="${html(t.id)}"><div class="card-top"><span class="tag">${html(t.category || 'Onderhoud')}</span><span class="card-arrow">↗</span></div><h3>${html(t.title)}</h3><div class="card-meta">${t.machine ? `⚙️ <b>${html(t.machine)}</b><br>` : ''}${t.frequency ? `◷ ${html(t.frequency)}` : 'Onderhoudsinstructie'}</div><div class="card-progress"><div class="card-progress-fill" style="width:${p.pct}%"></div></div><div class="card-bottom"><span>☑ ${p.done}/${p.total} afgevinkt</span><span>▧ ${(t.photos || []).length} foto's</span></div></button>`;
  }).join('');
}
function renderDetail() {
  const t = getTask(activeId);
  if (!t) return showView('home');
  const p = progress(t);
  const steps = t.steps || [], photos = t.photos || [], checks = t.checks || [];
  const allPhotoMarkup = photos.length ? `<div class="gallery">${photos.map(photo => {
    const stepNo = steps.findIndex(s => s.id === photo.stepId);
    return `<div class="photo-item"><img src="${imageSource(photo.data)}" loading="lazy" alt="${html(photo.caption || 'Onderhoudsfoto')}" data-zoom="${html(photo.id)}"><div class="photo-foot"><div>${stepNo >= 0 ? `<div class="photo-step-label">Bij stap ${stepNo+1}</div>` : ''}<div class="photo-caption">${html(photo.caption || 'Onderhoudsfoto')}</div></div><button type="button" class="photo-delete" data-delete-photo="${html(photo.id)}" aria-label="Foto verwijderen">✕</button></div></div>`;
  }).join('')}</div>` : '<p class="muted">Nog geen foto’s toegevoegd. Maak een foto van een onderdeel of voeg een bestaande foto toe.</p>';
  const stepsMarkup = steps.length ? steps.map((s,i) => {
    const linked = photos.filter(photo => photo.stepId === s.id && imageSource(photo.data));
    return `<div class="step"><div class="step-number">${i+1}</div><div><div class="step-text">${withBreaks(s.text)}</div>${linked.length ? `<div class="step-thumbs">${linked.map(photo => `<img src="${imageSource(photo.data)}" alt="${html(photo.caption || 'Foto bij stap '+(i+1))}" data-zoom="${html(photo.id)}">`).join('')}</div>` : ''}</div></div>`;
  }).join('') : '<p class="muted">Nog geen instructiestappen toegevoegd.</p>';
  const checksMarkup = checks.length ? checks.map(c => `<label class="check-row ${c.done?'done':''}"><input type="checkbox" data-check="${html(c.id)}" ${c.done?'checked':''}><span>${withBreaks(c.text)}</span></label>`).join('') : '<p class="muted">Nog geen checklistpunten toegevoegd.</p>';
  $('detailBody').innerHTML = `
    <div class="eyebrow green">${html(t.category || 'ONDERHOUD')}</div>
    <h1 class="detail-title">${html(t.title)}</h1>
    <div class="detail-meta">${t.machine ? `<span>⚙ ${html(t.machine)}</span>` : ''}${t.frequency ? `<span>◷ ${html(t.frequency)}</span>` : ''}<span>Bijgewerkt ${html(dateFormat(t.updatedAt))}</span></div>
    ${t.safety ? `<section class="block safety"><h2>⚠️ Veiligheid & voorwaarden</h2><p>${withBreaks(t.safety)}</p></section>` : ''}
    ${t.tools ? `<section class="block"><h2>🧰 Gereedschap & materiaal</h2><p>${withBreaks(t.tools)}</p></section>` : ''}
    <section class="block"><div class="block-head"><h2>Standaardwerkinstructie</h2><span class="tag">${steps.length} stappen</span></div>${stepsMarkup}</section>
    <section class="block"><div class="block-head"><h2>Checklist</h2><span class="tag">${p.pct}%</span></div>
      <div class="progress-label">${p.done} van ${p.total} punten afgerond</div><div class="progress-track"><div class="progress-fill" style="width:${p.pct}%"></div></div>
      <div>${checksMarkup}</div>${checks.length ? '<button type="button" class="button button-quiet button-small" id="resetChecklist">↺ Checklist opnieuw beginnen</button>' : ''}</section>
    <section class="block"><div class="block-head"><h2>Foto's (${photos.length})</h2><button type="button" class="button button-primary button-small" id="addPhoto">＋ Foto</button></div>${allPhotoMarkup}</section>
    <div class="danger-zone"><button type="button" class="button button-danger button-small" id="deleteTask">Taak verwijderen</button></div>`;
}
function renderBackup() {
  const n = tasks.length;
  const photos = tasks.reduce((s,t) => s + (t.photos || []).length,0);
  $('backupStats').textContent = `${n} taken en ${photos} foto's opgeslagen op dit apparaat.`;
}
function renumberRows(container) {
  [...container.querySelectorAll('.row-number')].forEach((item,i) => {item.textContent=i+1;});
}
function appendStep(text='', id=uuid()) {
  const div = document.createElement('div'); div.className='edit-row'; div.dataset.id=id;
  div.innerHTML = `<span class="row-number"></span><textarea rows="2" class="step-input" maxlength="2000" placeholder="Beschrijf de werkinstructiestap">${html(text)}</textarea><button type="button" class="remove-row" title="Stap verwijderen" aria-label="Stap verwijderen">✕</button>`;
  $('stepsEditor').append(div); renumberRows($('stepsEditor'));
}
function appendCheck(text='', id=uuid(), done=false) {
  const div=document.createElement('div'); div.className='edit-row'; div.dataset.id=id; div.dataset.done=done?'true':'false';
  div.innerHTML=`<span class="row-number"></span><input class="check-input" type="text" maxlength="500" placeholder="Wat moet je controleren?" value="${html(text)}"><button type="button" class="remove-row" title="Punt verwijderen" aria-label="Punt verwijderen">✕</button>`;
  $('checksEditor').append(div); renumberRows($('checksEditor'));
}
function openEditor(id=null) {
  const t = id ? getTask(id) : null;
  editingId = t ? id : null;
  $('editorTitle').textContent = t ? 'Taak bewerken' : 'Nieuwe taak';
  $('formTitle').value=t?.title || '';
  $('formMachine').value=t?.machine || '';
  $('formCategory').value=t?.category || 'Preventief onderhoud';
  $('formFrequency').value=t?.frequency || '';
  $('formTools').value=t?.tools || '';
  $('formSafety').value=t?.safety || '';
  $('stepsEditor').replaceChildren(); $('checksEditor').replaceChildren();
  if (t?.steps?.length) t.steps.forEach(s=>appendStep(s.text,s.id)); else appendStep();
  if (t?.checks?.length) t.checks.forEach(c=>appendCheck(c.text,c.id,c.done)); else appendCheck();
  $('editorDialog').showModal();
  setTimeout(()=>$('formTitle').focus(),40);
}
function closeEditor() { $('editorDialog').close(); }
async function submitTask(event) {
  event.preventDefault();
  const title=$('formTitle').value.trim();
  if (!title) { showToast('Vul een naam voor de taak in.'); return; }
  const steps=[...$('stepsEditor').querySelectorAll('.edit-row')].map(row=>({id:row.dataset.id,text:row.querySelector('textarea').value.trim()})).filter(s=>s.text);
  const checks=[...$('checksEditor').querySelectorAll('.edit-row')].map(row=>({id:row.dataset.id,text:row.querySelector('input').value.trim(),done:row.dataset.done==='true'})).filter(c=>c.text);
  const old=editingId ? getTask(editingId) : null;
  const record={
    id:old?.id||uuid(),title,machine:$('formMachine').value.trim(),category:$('formCategory').value,
    frequency:$('formFrequency').value.trim(),tools:$('formTools').value.trim(),safety:$('formSafety').value.trim(),
    steps,checks,photos:old?.photos||[],updatedAt:new Date().toISOString()
  };
  $('saveTaskButton').disabled=true;
  try {
    await saveTask(record); closeEditor(); activeId=record.id; showView('detail');
    showToast(old?'Taak bijgewerkt':'Taak opgeslagen. Voeg nu eventueel foto’s toe.');
  } catch (err) { console.error(err); alert('Opslaan is niet gelukt. Controleer de opslagruimte van je iPhone.'); }
  finally { $('saveTaskButton').disabled=false; }
}
function openPhotoDialog() {
  const t=getTask(activeId); if (!t) return;
  $('photoForm').reset();
  $('photoStep').innerHTML='<option value="">Algemene foto</option>'+(t.steps||[]).map((s,i)=>`<option value="${html(s.id)}">Stap ${i+1}: ${html(s.text.slice(0,54))}</option>`).join('');
  $('photoDialog').showModal();
}
function compressImage(file) {
  return new Promise((resolve,reject)=>{
    if (!file.type.startsWith('image/')) return reject(new Error('Geen afbeelding'));
    if (file.size>35000000) return reject(new Error('Foto groter dan 35 MB'));
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      try {
        let w=img.naturalWidth, h=img.naturalHeight;
        const max=1440; const ratio=Math.min(1,max/Math.max(w,h)); w=Math.round(w*ratio);h=Math.round(h*ratio);
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Afbeelding kan niet worden verwerkt');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
        const data=canvas.toDataURL('image/jpeg',.74);
        URL.revokeObjectURL(url);canvas.width=canvas.height=0;
        resolve(data);
      } catch(error){URL.revokeObjectURL(url);reject(error);}
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Kan deze afbeelding niet openen'));};
    img.src=url;
  });
}
async function submitPhoto(event) {
  event.preventDefault();
  const t=getTask(activeId); if(!t)return;
  const files=Array.from($('photoFiles').files||[]);
  if(!files.length){showToast('Kies eerst een foto.');return;}
  if ((t.photos||[]).length + files.length > 50) {alert('Maximaal 50 foto’s per taak. Maak eventueel een tweede taak.');return;}
  $('savePhotoButton').disabled=true; $('savePhotoButton').textContent='Foto’s verwerken…';
  try {
    const caption=$('photoCaption').value.trim();const stepId=$('photoStep').value;
    const additions=[];
    for(const file of files) additions.push({id:uuid(),caption:caption || (files.length>1?file.name:''),stepId,data:await compressImage(file)});
    const updated={...t,photos:[...(t.photos||[]),...additions]};
    await saveTask(updated);$('photoDialog').close();renderDetail();showToast(files.length===1?'Foto toegevoegd':files.length+' foto’s toegevoegd');
  } catch(error) {console.error(error);alert('Foto toevoegen mislukt: '+error.message+'\nProbeer een kleinere of andere foto.');}
  finally{$('savePhotoButton').disabled=false;$('savePhotoButton').textContent='Foto toevoegen';}
}
async function toggleCheck(id, done) {
  const t=getTask(activeId); if (!t) return;
  const updated={...t,checks:(t.checks||[]).map(c=>c.id===id?{...c,done}:c)};
  try{await saveTask(updated);renderDetail();}catch(err){console.error(err);showToast('Opslaan is mislukt');renderDetail();}
}
async function resetChecks() {
  const t=getTask(activeId);if(!t||!t.checks?.length)return;
  if(!confirm('Alle vinkjes verwijderen voor een nieuwe uitvoering?'))return;
  try{await saveTask({...t,checks:t.checks.map(c=>({...c,done:false}))});renderDetail();showToast('Checklist opnieuw gestart');}catch(err){console.error(err);showToast('Opslaan is mislukt');}
}
async function removePhoto(id) {
  if(!confirm('Deze foto definitief verwijderen?'))return;
  const t=getTask(activeId);if(!t)return;
  try{await saveTask({...t,photos:(t.photos||[]).filter(p=>p.id!==id)});renderDetail();showToast('Foto verwijderd');}catch(error){console.error(error);alert('Verwijderen mislukt');}
}
async function removeTask() {
  const t=getTask(activeId);if(!t)return;
  if(!confirm(`Wil je “${t.title}” inclusief alle foto’s en checklistpunten definitief verwijderen?`))return;
  try{await deleteRecord(t.id);tasks=tasks.filter(r=>r.id!==t.id);activeId=null;showView('home');showToast('Taak verwijderd');}catch(error){console.error(error);alert('Verwijderen mislukt');}
}
function showPhoto(id) {
  const photo=byId(getTask(activeId)?.photos||[],id);
  if (!photo||!imageSource(photo.data))return;
  const dialog=document.createElement('dialog');dialog.className='photo-preview';
  dialog.style.cssText='width:min(98vw,1000px);max-height:95dvh;border:0;border-radius:12px;background:#122526;padding:10px;color:white;text-align:center';
  const img=document.createElement('img');img.src=photo.data;img.alt=photo.caption||'Onderhoudsfoto';img.style.cssText='max-width:100%;max-height:78dvh;object-fit:contain;display:block;margin:0 auto;border-radius:5px';
  const caption=document.createElement('p');caption.textContent=photo.caption||'';caption.style.cssText='margin:7px 0;color:#fff;font-size:13px';
  const btn=document.createElement('button');btn.textContent='Sluiten ✕';btn.className='button button-light button-small';btn.type='button';btn.style.margin='7px';btn.addEventListener('click',()=>dialog.close());
  dialog.append(img,caption,btn);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
function exportBackup() {
  const backup={app:'WerkStandaard',version:1,exportedAt:new Date().toISOString(),tasks};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='werkstandaard-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  showToast('Back-up aangemaakt. Bewaar het bestand in Bestanden.');
}
function normalizeImport(t) {
  if(!t||typeof t!=='object'||!String(t.title||'').trim())return null;
  const safeText=(v,n=2000)=>String(v??'').slice(0,n);
  const strId=(v)=>typeof v==='string' && v.length<=140 && v.length>0 ? v : uuid();
  const steps=Array.isArray(t.steps)?t.steps.slice(0,200).filter(s=>s && s.text).map(s=>({id:strId(s.id),text:safeText(s.text)})):[];
  const checks=Array.isArray(t.checks)?t.checks.slice(0,200).filter(c=>c && c.text).map(c=>({id:strId(c.id),text:safeText(c.text,500),done:c.done===true})):[];
  const photos=Array.isArray(t.photos)?t.photos.slice(0,50).filter(p=>p && imageSource(p.data)).map(p=>({id:strId(p.id),caption:safeText(p.caption,160),stepId:safeText(p.stepId,140),data:p.data})):[];
  return {id:strId(t.id),title:safeText(t.title,120),machine:safeText(t.machine,120),category:safeText(t.category,80),frequency:safeText(t.frequency,60),tools:safeText(t.tools),safety:safeText(t.safety),steps,checks,photos,updatedAt:new Date().toISOString()};
}
async function importBackup(event) {
  const file=event.target.files?.[0]; if(!file)return;
  try {
    const data=JSON.parse(await file.text());
    if(data.app!=='WerkStandaard'||!Array.isArray(data.tasks))throw new Error('Dit is geen geldig WerkStandaard-back-upbestand.');
    const records=data.tasks.map(normalizeImport).filter(Boolean);
    if(!confirm(`${records.length} taken importeren? Gelijknamige ID’s worden vervangen; andere taken blijven bestaan.`))return;
    for(const record of records)await putRecord(record);
    tasks=await allRecords();renderBackup();showToast(records.length+' taken teruggezet');
  }catch(error){console.error(error);alert('Back-up terugzetten mislukt: '+error.message);}
  finally{event.target.value='';}
}
function attachEvents() {
  ['heroNew','topNew','navNew'].forEach(id=>$(id).addEventListener('click',()=>openEditor()));
  ['navHome','backToHome'].forEach(id=>$(id).addEventListener('click',()=>showView('home')));
  ['navBackup','headerBackup'].forEach(id=>$(id).addEventListener('click',()=>showView('backup')));
  $('searchInput').addEventListener('input',renderHome);
  $('categoryFilter').addEventListener('change',renderHome);
  $('taskList').addEventListener('click',(ev)=>{
    const btn=ev.target.closest('[data-open]');if(btn)openTask(btn.dataset.open);
    if(ev.target.closest('[data-action="new"]'))openEditor();
  });
  $('backToHome').addEventListener('keydown',(ev)=>{if(ev.key==='Enter')showView('home');});
  $('editTask').addEventListener('click',()=>openEditor(activeId));
  $('closeEditor').addEventListener('click',closeEditor);
  $('cancelEditor').addEventListener('click',closeEditor);
  $('taskForm').addEventListener('submit',submitTask);
  $('addStep').addEventListener('click',()=>appendStep());
  $('addCheck').addEventListener('click',()=>appendCheck());
  ['stepsEditor','checksEditor'].forEach(id=>$(id).addEventListener('click',(ev)=>{
    if(ev.target.closest('.remove-row')){
      ev.target.closest('.edit-row').remove();renumberRows($(id));
    }
  }));
  $('detailBody').addEventListener('click',(ev)=>{
    const photoDel=ev.target.closest('[data-delete-photo]');
    if(photoDel){removePhoto(photoDel.dataset.deletePhoto);return;}
    const zoom=ev.target.closest('[data-zoom]');if(zoom){showPhoto(zoom.dataset.zoom);return;}
    if(ev.target.closest('#resetChecklist'))resetChecks();
    if(ev.target.closest('#addPhoto'))openPhotoDialog();
    if(ev.target.closest('#deleteTask'))removeTask();
  });
  $('detailBody').addEventListener('change',(ev)=>{
    if(ev.target.matches('[data-check]'))toggleCheck(ev.target.dataset.check,ev.target.checked);
  });
  $('closePhoto').addEventListener('click',()=>$('photoDialog').close());
  $('cancelPhoto').addEventListener('click',()=>$('photoDialog').close());
  $('photoForm').addEventListener('submit',submitPhoto);
  $('exportButton').addEventListener('click',exportBackup);
  $('importInput').addEventListener('change',importBackup);
}
async function start() {
  attachEvents();
  try {
    database=await openDatabase();tasks=await allRecords();
    if(!localStorage.getItem('werkstandaard-initialized')){
      if(!tasks.length){const demo=initialDemo();await saveTask(demo);}
      localStorage.setItem('werkstandaard-initialized','yes');
    }
    renderHome();
  } catch(error) {
    console.error(error);
    $('taskList').innerHTML='<div class="empty"><h3>Opslag niet beschikbaar</h3><p>Open deze app in Safari of via het beginscherm van je iPhone. Privémodus of beperkte opslag kan het bewaren van taken verhinderen.</p></div>';
    showToast('Lokale opslag kon niet worden geopend');
    ['heroNew','topNew','navNew'].forEach(id=>$(id).disabled=true);
  }
  if ('serviceWorker' in navigator && location.protocol==='https:') {
    navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Offline cache niet beschikbaar',err));
  }
}
start();
