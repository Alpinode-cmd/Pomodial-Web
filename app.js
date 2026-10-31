/* Pomodial Web — vanilla JavaScript PWA port of the supplied SwiftUI project.
 * Local-only persistence; no Family Controls or server-backed push notifications.
 */
'use strict';
const $=(id)=>document.getElementById(id);
const SETTINGS_KEY='pomodial:web:settings:v1';
const ENGINE_KEY='pomodial:web:engine:v1';
const RECORDS_KEY='pomodial:web:records:v1';
const sounds=['chime','marimba','bell','bowl','digital','pop'];
const defaults={workMinutes:25,shortBreakMinutes:5,longBreakMinutes:15,cyclesBeforeLongBreak:3,soundEnabled:true,workSoundID:'chime',breakSoundID:'marimba',vibrationEnabled:true,notificationsEnabled:true,keepScreenOn:true,dailyGoalMinutes:180,language:'ja'};
const limits={workMinutes:[5,60,1],shortBreakMinutes:[1,30,1],longBreakMinutes:[5,60,1],cyclesBeforeLongBreak:[2,6,1],dailyGoalMinutes:[30,720,30]};
function storageRead(key,fallback){try{const v=JSON.parse(localStorage.getItem(key));return v===null?fallback:v}catch{return fallback}}
function storageWrite(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{toast(t('storageFailed'))}}
function clamp(value,min,max){return Math.min(max,Math.max(min,value))}
function phaseOf(index){return index%2===0?'work':index===stepsCount()-1?'longBreak':'shortBreak'}
function stepsCount(){return Math.max(2,settings.cyclesBeforeLongBreak)*2}
function durationFor(phase){return (phase==='work'?settings.workMinutes:phase==='shortBreak'?settings.shortBreakMinutes:settings.longBreakMinutes)*60}
const phaseKeys={work:'workPhase',shortBreak:'shortBreakPhase',longBreak:'longBreakPhase'};
let settings={...defaults,...storageRead(SETTINGS_KEY,{})};
for(const [key,[min,max]] of Object.entries(limits))settings[key]=clamp(Number(settings[key])||defaults[key],min,max);
settings.language=['ja','en'].includes(settings.language)?settings.language:'ja';
function t(key,args={}){
  const item=I18N[settings.language][key]??I18N.ja[key]??key;
  return typeof item==='string'?item.replace(/\{(\w+)\}/g,(_,k)=>String(args[k]??'')):item;
}
function phaseName(phase){return t(phaseKeys[phase]||phaseKeys.work)}
function formatMinutes(n){return t('mins',{count:n})}
function formatCount(n){return t('cycles',{count:n})}
function applyLanguage(){
  document.documentElement.lang=settings.language;
  document.title=t('pageTitle');
  const description=document.querySelector('meta[name="description"]');
  if(description)description.setAttribute('content',t('pageDescription'));
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});
  document.querySelectorAll('[data-i18n-aria]').forEach(el=>{el.setAttribute('aria-label',t(el.dataset.i18nAria))});
  document.querySelectorAll('[data-i18n-title]').forEach(el=>{el.title=t(el.dataset.i18nTitle)});
  $('languageSelect').value=settings.language;
  refreshSoundOptions();
}
function refreshSoundOptions(){
  for(const key of ['workSoundID','breakSoundID']){
    const select=$(key);
    select.innerHTML=sounds.map(id=>`<option value="${id}">${t('soundNames')[id]}</option>`).join('');
    select.value=settings[key];
  }
}
const blankEngine=()=>({stepIndex:0,phaseDuration:settings.workMinutes*60,running:false,endDate:null,pausedRemaining:settings.workMinutes*60,hasStartedPhase:false,segmentStart:null,elapsedBeforeSegment:0,phaseStartedAt:null});
let state={...blankEngine(),...storageRead(ENGINE_KEY,{})};
if(!Number.isFinite(state.phaseDuration)||!Number.isFinite(state.pausedRemaining)||!Number.isFinite(state.stepIndex))state=blankEngine();
state.stepIndex=((Math.floor(state.stepIndex)%stepsCount())+stepsCount())%stepsCount();
state.running=!!(state.running&&Number.isFinite(state.endDate));
let records=storageRead(RECORDS_KEY,[]);
if(!Array.isArray(records))records=[];
records=records.filter(r=>r&&['work','shortBreak','longBreak'].includes(r.phase)&&Number.isFinite(r.start)&&Number.isFinite(r.end)&&Number.isFinite(r.seconds));
let activeTab='timer',weekOffset=0,dragging=false,dragAngle=null,dragDegrees=null,dragMinutes=null,lockHintUntil=0,currentAudio=null,wakeLock=null,lastPaintSecond=-1,toastTimeout=null;
const dial=$('dial'),wedge=$('dial-wedge'),knob=$('knob');
const fmtClock=(seconds)=>{const v=Math.max(0,Math.ceil(seconds));return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`};
function fmtDuration(sec){const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return settings.language==='en'?(h?`${h}h${m?` ${m}m`:''}`:`${m}m`):(h?`${h}時間${m?`${m}分`:''}`:`${m}分`)}
function remaining(now=Date.now()){return state.running?Math.max(0,(state.endDate-now)/1000):state.pausedRemaining}
function progress(now=Date.now()){return clamp(1-remaining(now)/Math.max(state.phaseDuration,1),0,1)}
function saveEngine(){storageWrite(ENGINE_KEY,state)}
function saveSettings(){storageWrite(SETTINGS_KEY,settings)}
function saveHistory(){storageWrite(RECORDS_KEY,records)}
function currentElapsed(t){return Math.max(0,state.elapsedBeforeSegment+(state.running&&state.segmentStart!==null?Math.max(0,t-state.segmentStart)/1000:0))}
function recordPhase(end){const seconds=currentElapsed(end),phase=phaseOf(state.stepIndex);if(seconds<(phase==='work'?60:30))return;records.push({id:(crypto.randomUUID?.()||`${end}-${Math.random()}`),start:state.phaseStartedAt??end-seconds*1000,end,phase,seconds:Math.round(seconds)});records=records.filter(r=>r.end>=Date.now()-370*86400*1000);saveHistory()}
function advanceStep(){state.stepIndex=(state.stepIndex+1)%stepsCount();state.phaseDuration=durationFor(phaseOf(state.stepIndex));state.pausedRemaining=state.phaseDuration}
function completePhase(t,notify){recordPhase(t);advanceStep();state.elapsedBeforeSegment=0;state.segmentStart=t;state.phaseStartedAt=t;state.endDate=t+state.phaseDuration*1000;state.hasStartedPhase=true;saveEngine();if(notify)feedback(phaseOf(state.stepIndex));}
function catchUp(notify=true){if(!state.running)return;const now=Date.now();let n=0;while(state.running&&state.endDate<=now&&n<500){const endedAt=state.endDate;completePhase(endedAt,notify&&now-endedAt<3000&&n===0);n++}if(n){saveEngine();render(true)} }
function toggle(){if(state.running){pause()}else{start()}render(true)}
function start(){if(state.running)return;const t=Date.now();if(!state.hasStartedPhase)state.phaseStartedAt=t;state.hasStartedPhase=true;state.segmentStart=t;state.endDate=t+state.pausedRemaining*1000;state.running=true;saveEngine();refreshWakeLock();if(settings.notificationsEnabled&&('Notification'in window)&&Notification.permission==='default'&&!/iPhone|iPad|iPod/.test(navigator.userAgent)){/* Browser permission must follow a deliberate opt-in, not automatically prompt. */}}
function pause(){if(!state.running)return;const t=Date.now();state.pausedRemaining=Math.max(0,(state.endDate-t)/1000);if(state.segmentStart!==null)state.elapsedBeforeSegment+=Math.max(0,t-state.segmentStart)/1000;state.segmentStart=null;state.endDate=null;state.running=false;saveEngine();refreshWakeLock()}
function skip(){const t=Date.now();catchUp(false);recordPhase(t);advanceStep();state.elapsedBeforeSegment=0;if(state.running){state.segmentStart=t;state.phaseStartedAt=t;state.endDate=t+state.phaseDuration*1000;state.hasStartedPhase=true}else{state.segmentStart=null;state.phaseStartedAt=null;state.endDate=null;state.hasStartedPhase=false}saveEngine();render(true)}
function reset(){recordPhase(Date.now());state=blankEngine();saveEngine();refreshWakeLock();render(true);toast(t('resetDone'))}
function setTime(mins){const seconds=clamp(Math.round(mins),1,60)*60;const t=Date.now();state.phaseDuration=seconds;if(state.running){state.elapsedBeforeSegment+=Math.max(0,t-state.segmentStart)/1000;state.segmentStart=t;state.endDate=t+seconds*1000}else{state.pausedRemaining=seconds}saveEngine();render(true)}
function settingChanged(key,value){if(!(key in defaults))return;if(key in limits){const [min,max]=limits[key];value=clamp(Number(value),min,max)}settings[key]=value;saveSettings();if(['workMinutes','shortBreakMinutes','longBreakMinutes','cyclesBeforeLongBreak'].includes(key)){state.stepIndex=state.stepIndex%stepsCount();if(!state.running&&!state.hasStartedPhase){state.phaseDuration=durationFor(phaseOf(state.stepIndex));state.pausedRemaining=state.phaseDuration;saveEngine()}}if(key==='keepScreenOn')refreshWakeLock();if(key==='language')applyLanguage();render(true)}
function toast(message){const el=$('toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.hidden=true,2600)}
function polar(radius,degrees){const a=(degrees-90)*Math.PI/180;return [200+radius*Math.cos(a),200+radius*Math.sin(a)]}
function wedgePath(degrees){if(degrees<.01)return '';const radius=152;if(degrees>=359.999){return `M 200 200 L 200 ${200-radius} A ${radius} ${radius} 0 1 1 199.99 ${200-radius} Z`}const start=polar(radius,0),end=polar(radius,degrees);return `M 200 200 L ${start[0]} ${start[1]} A ${radius} ${radius} 0 ${degrees>180?1:0} 1 ${end[0]} ${end[1]} Z`}
function initDial(){let ticks='',numbers='';for(let i=0;i<60;i++){const major=i%5===0,a=6*i,o=polar(184,a),ins=polar(major?164:173,a);ticks+=`<line class="tick-line ${major?'major':''}" x1="${o[0]}" y1="${o[1]}" x2="${ins[0]}" y2="${ins[1]}"></line>`}for(let i=0;i<12;i++){const [x,y]=polar(133,i*30);numbers+=`<text class="dial-numeral" x="${x}" y="${y}">${i*5}</text>`}$('tickmarks').innerHTML=ticks;$('dial-numbers').innerHTML=numbers;}
function renderCycle(){
  const total=stepsCount()/2,idx=state.stepIndex,p=progress();let html='';
  for(let i=0;i<total;i++){
    const step=i*2,current=idx===step,done=idx>step;
    html+=`<div class="cycle-node ${current?'active':''} ${done?'complete':''}"><div class="cycle-circle">${done?'✓':i+1}</div><div class="cycle-caption">${t('workCycleNumber',{number:i+1})}</div></div>`;
    const connectorIdx=step+1;
    const fill=idx>connectorIdx?1:idx===connectorIdx?p:0;
    html+=`<div class="cycle-connector ${idx===connectorIdx?'active':''}"><div class="fill" style="width:${Math.floor(fill*100)}%"></div></div>`;
  }
  html+=`<div class="cycle-node end ${phaseOf(idx)==='longBreak'?'active':''}"><div class="cycle-circle">❧</div><div class="cycle-caption">${t('longBreakPhase')}</div></div>`;
  $('cycle-track').innerHTML=html;
}
function renderTimer(){
  const phase=phaseOf(state.stepIndex);
  document.documentElement.style.setProperty('--phase-tint',phase==='work'?'var(--coral)':'var(--mint)');
  document.documentElement.style.setProperty('--button-tint',phase==='work'?'var(--coral)':'var(--mint-deep)');
  const now=Date.now(),seconds=remaining(now);
  const degrees=dragDegrees!==null?dragDegrees:clamp(seconds/60*6,0,360);
  wedge.setAttribute('d',wedgePath(degrees));
  knob.style.transform=`translate(-50%, -50%) rotate(${degrees}deg)`;
  $('remaining-time').textContent=fmtClock(dragMinutes!==null?Math.max(1,dragMinutes)*60:seconds);
  $('timer-heading').textContent=phaseName(phase);
  $('toggle-text').textContent=state.running?t('pause'):state.hasStartedPhase?t('resume'):t('start');
  $('toggle-icon').textContent=state.running?'Ⅱ':'▶';
  $('dial').setAttribute('aria-valuenow',String(clamp(Math.round(seconds/60),1,60)));
  $('dial').setAttribute('aria-valuetext',fmtClock(seconds));
  $('dial').setAttribute('aria-disabled',String(state.running));
  $('dial-hint').textContent=state.running?t('dialLocked'):t('dialHint');
  $('dial-hint').classList.toggle('warning',lockHintUntil>Date.now());
  const long=phase==='longBreak';
  $('timer-content').classList.toggle('long',long);
  $('celebrate').hidden=!long;
  $('celebrate-desc').textContent=t('longBreakMessage',{minutes:formatMinutes(settings.longBreakMinutes)});
  $('session-info').textContent=long?t('workCompleted',{count:stepsCount()/2}):t('sessionStatus',{current:Math.floor(state.stepIndex/2)+1,total:stepsCount()/2});
  const next=phaseOf((state.stepIndex+1)%stepsCount());
  $('next-info').textContent=t('nextPhase',{minutes:formatMinutes(durationFor(next)/60),phase:phaseName(next)});
  $('skip-label').textContent=long?t('skipBreak'):t('skip');
  renderCycle();
}
function localDay(t){const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function secondsOn(day){return records.filter(r=>r.phase==='work'&&localDay(r.start)===day).reduce((s,r)=>s+r.seconds,0)}
function sameDay(r,day){return localDay(r.start)===day}
function mondayFor(offset){const d=new Date();d.setHours(12,0,0,0);const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday-offset*7);return d}
function renderStats(){
  const today=localDay(Date.now());
  const todays=records.filter(r=>sameDay(r,today)).sort((a,b)=>b.start-a.start);
  const focus=secondsOn(today),sessionCount=todays.filter(r=>r.phase==='work').length;
  const fraction=clamp(focus/Math.max(1,settings.dailyGoalMinutes*60),0,1);
  $('today-focus').textContent=fmtDuration(focus);
  $('today-sessions').textContent=t('todaySessionCount',{count:sessionCount});
  $('goal-percent').textContent=`${Math.round(fraction*100)}%`;
  $('goal-ring').style.setProperty('--goal-percent',`${fraction*100}%`);
  $('goal-label').textContent=t('goal',{duration:fmtDuration(settings.dailyGoalMinutes*60)});
  const monday=mondayFor(weekOffset);
  const days=Array.from({length:7},(_,i)=>{const date=new Date(monday);date.setDate(monday.getDate()+i);return {day:localDay(date),seconds:secondsOn(localDay(date))}});
  const sum=days.reduce((a,d)=>a+d.seconds,0);
  const peak=Math.max(4,Math.ceil(Math.max(...days.map(d=>d.seconds/3600))/1));
  $('week-total').textContent=t('totalDuration',{duration:fmtDuration(sum)});
  $('week-card-heading').textContent=weekOffset?t('weekFocusLast'):t('weekFocusThis');
  $('week-chart').innerHTML=days.map((day,i)=>{
    const height=day.seconds/3600/peak*100;
    return `<div class="chart-col"><div class="chart-bars"><div class="chart-bar ${day.day===today?'today':''}" style="height:${height}%" title="${day.day}: ${fmtDuration(day.seconds)}"></div></div><span class="chart-day">${t('weekdays')[i]}</span></div>`;
  }).join('');
  document.querySelectorAll('.chart-grid span').forEach((el,i)=>el.textContent=`${Math.round(peak*(4-i)/4*10)/10}h`);
  $('today-list').innerHTML=todays.length?todays.map(r=>`<div class="session-row"><div class="session-dot" style="background:${r.phase==='work'?'var(--coral)':'var(--mint)'}"></div><span class="session-date">${new Date(r.start).toLocaleTimeString(settings.language==='en'?'en-US':'ja-JP',{hour:'2-digit',minute:'2-digit'})}</span><span class="session-name">${phaseName(r.phase)}</span><span class="session-length">${formatMinutes(Math.max(1,Math.round(r.seconds/60)))}</span></div>`).join(''):`<div class="empty-sessions"><div class="empty-icon">◷</div><strong>${t('emptyTitle')}</strong><p>${t('emptyDetail')}</p></div>`;
}
function renderSettings(){
  for(const key of Object.keys(limits)){
    $(`value-${key}`).textContent=key==='cyclesBeforeLongBreak'?formatCount(settings[key]):key==='dailyGoalMinutes'?fmtDuration(settings[key]*60):formatMinutes(settings[key]);
  }
  $('guide-work-title').textContent=t('guideWorkTitle',{minutes:formatMinutes(settings.workMinutes)});
  $('guide-break-title').textContent=t('guideBreakTitle',{minutes:formatMinutes(settings.shortBreakMinutes)});
  $('guide-long-title').textContent=t('guideLongTitle',{count:settings.cyclesBeforeLongBreak});
  for(const k of ['soundEnabled','vibrationEnabled','notificationsEnabled','keepScreenOn'])$(k).checked=!!settings[k];
  for(const k of ['workSoundID','breakSoundID'])$(k).value=settings[k];
  $('languageSelect').value=settings.language;
  document.querySelectorAll('.sound-setting').forEach(el=>el.style.opacity=settings.soundEnabled?'1':'.45');
}
function render(force=false){if(activeTab==='timer'){renderTimer()}else if(force&&activeTab==='stats'){renderStats()}else if(force&&activeTab==='guide'){renderSettings()}if(force&&activeTab==='timer')renderSettings();}
function setTab(tab){if(!['timer','stats','guide'].includes(tab))return;activeTab=tab;for(const name of ['timer','stats','guide']){ $(`screen-${name}`).hidden=name!==tab;const button=document.querySelector(`[data-tab="${name}"]`);button.classList.toggle('active',name===tab);if(name===tab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')}render(true);window.scrollTo({top:0,behavior:'instant'})}
function stepSetting(key,delta){if(!(key in limits))return;settingChanged(key,settings[key]+delta)}
async function refreshWakeLock(){if(!settings.keepScreenOn||!state.running||document.visibilityState!=='visible'){if(wakeLock){try{await wakeLock.release()}catch{}wakeLock=null}return}if('wakeLock'in navigator&&!wakeLock){try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null})}catch{}}}
function playSound(id){if(!settings.soundEnabled)return;try{if(currentAudio){currentAudio.pause();currentAudio.currentTime=0}const a=new Audio(`./assets/sounds/${sounds.includes(id)?id:'chime'}.wav`);currentAudio=a;void a.play().catch(()=>{})}catch{}}
function feedback(phase){
  toast(t(phase==='work'?'focusStarted':'breakStarted'));
  if(settings.vibrationEnabled&&navigator.vibrate){try{navigator.vibrate([100,50,120])}catch{}}
  playSound(phase==='work'?settings.workSoundID:settings.breakSoundID);
  if(settings.notificationsEnabled&&'Notification'in window&&Notification.permission==='granted'&&document.visibilityState==='visible'){
    try{
      new Notification(t(phase==='work'?'notifyWorkTitle':'notifyBreakTitle'),{
        body:t(phase==='work'?'notifyWorkBody':'notifyBreakBody',{minutes:formatMinutes(phase==='work'?settings.workMinutes:durationFor(phase)/60)}),
        icon:'./assets/icons/icon-192.png'
      });
    }catch{}
  }
}
function startDrag(ev){if(state.running){lockHintUntil=Date.now()+1800;renderTimer();return}if(ev.button!==undefined&&ev.button!==0)return;dragging=true;dragAngle=null;dragDegrees=clamp(remaining()/60*6,0,360);dragMinutes=Math.max(1,Math.round(dragDegrees/6));dial.classList.add('dragging');try{dial.setPointerCapture(ev.pointerId)}catch{}ev.preventDefault()}
function angleFor(ev){const rect=dial.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,dx=ev.clientX-cx,dy=ev.clientY-cy;return ((Math.atan2(dx,-dy)*180/Math.PI)%360+360)%360}
function moveDrag(ev){if(!dragging)return;const angle=angleFor(ev);if(dragAngle===null){dragAngle=angle;return}let delta=angle-dragAngle;if(delta>180)delta-=360;if(delta< -180)delta+=360;dragDegrees=clamp(dragDegrees+delta,0,360);dragAngle=angle;const m=Math.max(1,Math.round(dragDegrees/6));if(m!==dragMinutes){dragMinutes=m;if(settings.vibrationEnabled&&navigator.vibrate)try{navigator.vibrate(5)}catch{}}renderTimer()}
function endDrag(){if(!dragging)return;dragging=false;dial.classList.remove('dragging');if(dragAngle!==null)setTime(Math.max(1,Math.round(dragDegrees/6)));dragAngle=null;dragDegrees=null;dragMinutes=null;renderTimer()}
function openAdjust(){
  const body=$('modal-body');body.innerHTML='';
  const labels={workMinutes:'workPhase',shortBreakMinutes:'shortBreak',longBreakMinutes:'longBreak',cyclesBeforeLongBreak:'cyclesBeforeLong'};
  for(const key of Object.keys(labels)){
    const div=document.createElement('div');div.className='modal-row';
    const label=document.createElement('span');label.textContent=t(labels[key]);
    const controls=document.createElement('div');controls.className='stepper';
    for(const sign of [-1,0,1]){
      if(!sign){
        const output=document.createElement('output');output.id=`modal-${key}`;
        output.textContent=key==='cyclesBeforeLongBreak'?formatCount(settings[key]):formatMinutes(settings[key]);
        controls.append(output);
      }else{
        const b=document.createElement('button');b.textContent=sign>0?'＋':'−';
        b.dataset.step=`${key}:${sign*(key==='workMinutes'||key==='longBreakMinutes'?5:1)}`;
        const labelKey=key==='workMinutes'?'WorkDuration':key==='shortBreakMinutes'?'ShortBreak':key==='longBreakMinutes'?'LongBreak':'CyclesBeforeLong';
        b.setAttribute('aria-label',t(`${sign>0?'increase':'decrease'}${labelKey}`));
        controls.append(b);
      }
    }
    div.append(label,controls);body.append(div);
  }
  $('modal-backdrop').hidden=false;
}
function closeAdjust(){$('modal-backdrop').hidden=true}
function createDownload(obj){const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`pomodial-backup-${localDay(Date.now())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function installListeners(){
  $('toggle-btn').addEventListener('click',toggle);
  $('skip-btn').addEventListener('click',skip);
  $('reset-btn').addEventListener('click',reset);
  $('adjust-btn').addEventListener('click',openAdjust);
  $('close-modal').addEventListener('click',closeAdjust);
  $('modal-done').addEventListener('click',closeAdjust);
  $('modal-backdrop').addEventListener('click',e=>{if(e.target===$('modal-backdrop'))closeAdjust()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAdjust()});
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  $('week-offset').addEventListener('change',e=>{weekOffset=Number(e.target.value)||0;renderStats()});
  $('languageSelect').addEventListener('change',e=>settingChanged('language',e.target.value));
  document.addEventListener('click',e=>{
    const b=e.target.closest('button[data-step]');
    if(b){const [key,raw]=b.dataset.step.split(':');stepSetting(key,Number(raw));if(!$('modal-backdrop').hidden)openAdjust()}
  });
  for(const key of ['soundEnabled','vibrationEnabled','notificationsEnabled','keepScreenOn'])$(key).addEventListener('change',e=>settingChanged(key,e.target.checked));
  for(const key of ['workSoundID','breakSoundID'])$(key).addEventListener('change',e=>settingChanged(key,e.target.value));
  for(const b of document.querySelectorAll('[data-preview]'))b.addEventListener('click',()=>playSound(settings[b.dataset.preview]));
  dial.addEventListener('pointerdown',startDrag);
  dial.addEventListener('pointermove',moveDrag);
  dial.addEventListener('pointerup',endDrag);
  dial.addEventListener('pointercancel',endDrag);
  dial.addEventListener('lostpointercapture',endDrag);
  dial.addEventListener('keydown',e=>{
    if(state.running)return;
    if(e.key==='ArrowRight'||e.key==='ArrowUp'){e.preventDefault();setTime(remaining()/60+1)}
    if(e.key==='ArrowLeft'||e.key==='ArrowDown'){e.preventDefault();setTime(remaining()/60-1)}
  });
  $('export-btn').addEventListener('click',()=>createDownload({format:'pomodial-web-v1',exportedAt:new Date().toISOString(),settings,records}));
  $('import-input').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const obj=JSON.parse(await file.text());
      if(obj.format!=='pomodial-web-v1'||!Array.isArray(obj.records))throw Error('format');
      const valid=obj.records.filter(r=>r&&['work','shortBreak','longBreak'].includes(r.phase)&&Number.isFinite(r.start)&&Number.isFinite(r.end)&&Number.isFinite(r.seconds)&&r.seconds>=0&&r.end>=r.start);
      if(!confirm(t('importConfirm',{count:valid.length})))return;
      const keys=new Set(records.map(r=>r.id));
      for(const r of valid)if(!keys.has(r.id)){records.push(r);keys.add(r.id)}
      saveHistory();render(true);toast(t('importDone',{count:valid.length}));
    }catch{toast(t('importError'))}finally{e.target.value=''}
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){catchUp(false);render(true)}refreshWakeLock()});
  window.addEventListener('pageshow',()=>{catchUp(false);render(true);refreshWakeLock()});
}
function tick(){catchUp(true);const second=Math.ceil(remaining());if(second!==lastPaintSecond||dragging){lastPaintSecond=second;if(activeTab==='timer')renderTimer()}}
function init(){
  initDial();
  applyLanguage();
  catchUp(false);
  installListeners();
  setTab('timer');
  refreshWakeLock();
  setInterval(tick,240);
  if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
init();
