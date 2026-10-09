(function(root){
  'use strict';
  const Model=root.WorkbenchRadarModel,Adapter=root.WorkbenchRadarAdapter;
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let host=null,service=null,current=null,generatedFeed=[],mode='discover',statusFilter='all',allCandidatesFilter='all',busy=false,dialog=null,message='',error=false;
  function button(action,label,extra=''){return `<button type="button" class="r2-button" data-radar-action="${action}" ${extra}>${label}</button>`;}
  function active(){return host?.querySelector('.r2-radar');}
  function notify(text,isError=false){message=text;error=isError;const el=dialog?.open?dialog.querySelector('.r2-message'):host?.querySelector('#r2Message');if(el){el.textContent=text;el.classList.toggle('r2-error',isError);}}
  function setBusy(value){
    for(const scope of [active(),dialog])scope?.querySelectorAll('button,input,textarea,select').forEach(el=>{
      if(value){el.dataset.r2Disabled=String(el.disabled);el.disabled=true;}
      else if(el.dataset.r2Disabled!==undefined){el.disabled=el.dataset.r2Disabled==='true';delete el.dataset.r2Disabled;}
    });
  }
  function closeDialog(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
  async function perform(action,successText){
    if(busy)return;busy=true;setBusy(true);notify('正在保存…');
    try{const result=await action();busy=false;setBusy(false);closeDialog();notify(successText|| (result&&'added'in result?(result.added?'已保存为候选':'已保存过这条候选，保留原状态和备注'):'已保存'));render();}
    catch(e){busy=false;setBusy(false);notify(e.message+'。未确认成功，当前输入仍保留。',true);}
  }
  function shortText(text,limit=240){
    if(!text)return '<span class="r2-muted">原记录未提供</span>';
    if(text.length<=limit)return `<p class="r2-text">${esc(text)}</p>`;
    return `<p class="r2-text">${esc(text.slice(0,limit))}…</p><details><summary>展开完整说明</summary><p class="r2-text">${esc(text)}</p></details>`;
  }
  function directionLabel(id){
    if(!id)return '未分类';const d=current.directions.find(r=>r.id===id);
    return d?d.data.title+(d.deletedAt?'（已删除）':d.data.enabled?'':'（已暂停）'):'未分类';
  }
  function displayStatus(record){
    const d=record.data;
    if(d.status==='adopted'&&!d.madeVideoAt)return d.eventId?'selected':'considering';
    if(d.status==='candidate')return 'considering';
    return d.status;
  }
  function needsCloudBaseline(){
    if(!document.querySelector('meta[name="workbench-deployment"][content="github-pages-v2"]'))return false;
    try{
      const config=root.WorkbenchSyncConfig.read(localStorage);
      return !localStorage.getItem(root.WorkbenchDataV2.STORAGE_KEY)||!config?.knownVersionId||!config.lastSuccessAt;
    }catch(_){return true;}
  }
  const CLASSIFICATIONS=Object.freeze([['selected','选题'],['considering','待选'],['abandoned','PASS']]);
  const ALL_CANDIDATE_FILTERS=Object.freeze([['all','全部状态'],...CLASSIFICATIONS,['adopted','已做成视频']]);
  function sourcesHtml(sources){
    return sources.length?'<ul class="r2-sources">'+sources.map(s=>`<li>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label||s.url)}</a>`:`<span>${esc(s.label)}</span><small>（原记录未提供链接）</small>`}</li>`).join('')+'</ul>':'<p class="r2-muted">原记录未提供来源</p>';
  }
  function topicCard(data,index,record){
    const saved=current.candidates.find(r=>data.eventId?r.data.eventId===data.eventId:r.data.dedupeKey===data.dedupeKey);
    const identity=record?`data-candidate-id="${esc(record.id)}"`:data.eventId?`data-generated-index="${index}"`:'';
    const state=record?displayStatus(record):'',label={selected:'选题',considering:'待选',abandoned:'PASS',adopted:'已做成视频'}[state];
    const stateBadge=label?`<span class="r2-state-label">${esc(label)}</span>`:'';
    const madeAction=record?button('made-video',state==='adopted'?'已标记做成视频':'标记已做成视频',state==='adopted'?'disabled':''):'';
    const note=data.status==='abandoned'?`<p class="r2-note"><b>为什么没做：</b>${esc(data.abandonReason||'暂未填写')}</p>`:data.status==='adopted'&&data.madeVideoAt?`<p class="r2-note"><b>制作备注：</b>${esc(data.adoptNote||'暂未填写')}</p>`:'';
    const classificationButtons=CLASSIFICATIONS.map(([key,text])=>button('classify',text,`data-classification="${key}" aria-pressed="${state===key}" ${state===key?'disabled':''}`)).join('');
    const classification=state==='adopted'
      ?`<div class="r2-reclassify" role="group" aria-label="修改状态"><span class="r2-reclassify-label">修改状态</span><div class="r2-state-buttons">${classificationButtons}</div></div>`
      :`<div class="r2-state-buttons" role="group" aria-label="事件归类">${classificationButtons}</div>`;
    const actions=record?`${classification}${note}${button('candidate-edit','备注 / 所属方向')}`:data.eventId?classification:button('save',saved?(saved.deletedAt?'已保存过（已删除）':'已保存为候选'):'保存为候选',saved?'disabled':'');
    if(data.eventId)return `<article class="r2-topic r2-generated" ${identity}>
      <header class="r2-topic-head"><h3>${esc(data.title)}</h3><span class="r2-tag">${esc(directionLabel(data.directionId))}</span>${stateBadge}${madeAction}</header>
      <section class="r2-brief"><h4>这件事具体怎么回事</h4><p class="r2-text">${esc(data.eventBrief||'现有资料不足')}</p></section>
      <section class="r2-reason"><h4>为什么值得我关注</h4><p class="r2-text">${esc(data.reason||'暂未提供')}</p><p class="r2-reason-meta">关联方向：${esc(directionLabel(data.directionId))}</p></section>
      <section class="r2-angle"><h4>可以怎么讲（创作建议）</h4><p class="r2-text">${esc(data.angle||'暂未提供')}</p></section>
      <details class="r2-fold r2-example"><summary>这个视频可能长这样</summary><p class="r2-text">${esc(data.example||'暂未提供')}</p></details>
      <details class="r2-fold r2-risk"><summary>别说过头的地方</summary><p class="r2-text">${esc(data.riskNote||'暂未提供')}</p></details>
      <section class="r2-source-section"><h4>来源</h4>${sourcesHtml(data.sources)}</section>
      <footer>${actions}</footer></article>`;
    return `<article class="r2-topic r2-legacy-topic" ${identity}>
      <header class="r2-topic-head"><h3>${esc(data.title)}</h3><span class="r2-tag">${esc(directionLabel(data.directionId))}</span>${stateBadge}${madeAction}</header>
      <div class="r2-origin">${data.originalCategory?`<span>原分类：${esc(data.originalCategory)}</span>`:''}${data.origin==='legacy'?'<span>历史导入</span>':''}</div>
      <section class="r2-reason"><h4>为什么适合你</h4>${shortText(data.reason)}</section>
      <section class="r2-angle"><h4>改编角度</h4>${shortText(data.angle,400)}</section>
      <section class="r2-example"><h4>🎬 这个选题长这样</h4>${shortText(data.example,300)}</section>
      <section class="r2-source-section"><h4>来源</h4>${sourcesHtml(data.sources)}</section>
      <footer>${actions}</footer></article>`;
  }
  function directionCard(record,index,total){
    const d=record.data;
    return `<article class="r2-direction" data-direction-id="${esc(record.id)}"><header><h3>${esc(d.title)}</h3><span class="r2-tag">${d.enabled?'已启用':'已暂停'}</span></header>
      <dl><dt>我要找什么</dt><dd>${esc(d.find||'暂未填写')}</dd><dt>排除什么</dt><dd>${esc(d.exclude||'暂未填写')}</dd><dt>适用账号 / 当前内容阶段</dt><dd>${esc(d.accountStage||'暂未填写')}</dd></dl>
      <footer>${button('direction-edit','编辑')}${button('direction-toggle',d.enabled?'暂停':'启用')}${button('direction-up','上移',index===0?'disabled':'')}${button('direction-down','下移',index===total-1?'disabled':'')}${button('direction-delete','删除')}</footer></article>`;
  }
  function render(){
    if(!host)return;
    try{current=service.snapshot();}catch(e){host.innerHTML=`<section class="r2-radar"><p role="alert" class="r2-error">${esc(e.message)}。没有改写选题数据。</p></section>`;return;}
    const liveDirections=current.directions.filter(r=>r.deletedAt===null),enabled=liveDirections.filter(r=>r.data.enabled);
    const activeCandidateFilter=mode==='candidates'&&statusFilter==='all'?allCandidatesFilter:statusFilter;
    const candidates=current.candidates.filter(r=>r.deletedAt===null&&(activeCandidateFilter==='all'||displayStatus(r)===activeCandidateFilter));
    const unclassified=generatedFeed.map((data,index)=>({data,index})).filter(({data})=>!current.candidates.some(r=>r.data.eventId===data.eventId));
    let body='';
    if(mode==='manage')body=`<section><h3 class="r2-section-title">管理方向</h3><div class="r2-direction-list">${liveDirections.length?liveDirections.map((r,i)=>directionCard(r,i,liveDirections.length)).join(''):'<p class="r2-empty">还没有选题方向，可以从自己的内容想法开始。</p>'}</div></section>`;
    else if(mode==='candidates'){
      const filterTitle=statusFilter==='all'?'全部候选':({selected:'选题',considering:'待选',adopted:'已做成视频',abandoned:'PASS'}[statusFilter]||'全部候选');
      const filterControl=statusFilter==='all'?`<label class="r2-filter">归类状态：<select id="r2StatusFilter" aria-label="归类状态">${ALL_CANDIDATE_FILTERS.map(([key,label])=>`<option value="${key}" ${allCandidatesFilter===key?'selected':''}>${label}</option>`).join('')}</select></label>`:'';
      body=`<section><div class="r2-candidate-tools"><h3 class="r2-section-title">${filterTitle}</h3>${filterControl}</div><div class="r2-topic-list">${candidates.length?candidates.map(r=>topicCard(r.data,0,r)).join(''):'<p class="r2-empty">这里还没有对应选题。未归类发现可通过卡片底部按钮归类。</p>'}</div></section>`;
    }
    else body=needsCloudBaseline()
      ?`<section class="r2-empty" role="status"><h3>尚未确认云端业务状态</h3><p>此网址的浏览器数据独立保存。先到云端同步读取、预览并确认业务数据；在此之前暂不显示“未归类”，避免把已归类或 PASS 的旧发现误认成新卡。</p>${button('open-sync','前往云端同步')}</section>`
      :`<section><h3 class="r2-section-title">未归类 · 本轮 AI 新闻发现</h3><p class="r2-feed-note">${generatedFeed.length} 条事件发现。自动加工卡基于搜索来源线索，事实细节请结合来源复核。只有点击选题、待选或 PASS，才写入本地雷达。</p><div class="r2-topic-list">${unclassified.length?unclassified.map(({data,index})=>topicCard(data,index)).join(''):'<p class="r2-empty">本轮发现已全部归类。可从上方查看选题、待选和 PASS。</p>'}</div></section>`;
    host.innerHTML=`<section class="r2-radar" aria-label="选题雷达">
      <section class="r2-directions-top"><header><h3>我的选题方向</h3><div class="r2-actions">${button('direction-new','＋ 新增方向')}${button('manage','管理方向')}</div></header>
        <div class="r2-chips">${enabled.length?enabled.map(d=>`<span class="r2-chip">${esc(d.data.title)}</span>`).join(''):'<p class="r2-muted">还没有启用方向，可以先配置，也可以浏览现有选题。</p>'}</div></section>
      <nav class="r2-tabs" aria-label="雷达内容">${button('discover','未归类',`aria-pressed="${mode==='discover'}"`)}${[...CLASSIFICATIONS,['adopted','已做成视频']].map(([key,label])=>button('status-view',label,`data-status="${key}" aria-pressed="${mode==='candidates'&&statusFilter===key}"`)).join('')}${button('candidates','全部候选',`aria-pressed="${mode==='candidates'&&statusFilter==='all'}"`)}</nav>
      <p id="r2Message" role="status" aria-live="polite" class="r2-message ${error?'r2-error':''}">${esc(message)}</p>${body}</section>`;
    if(busy)setBusy(true);
  }
  function openDialog(title,body,onSubmit,label='保存',danger=false){
    closeDialog();dialog=document.createElement('dialog');dialog.className='r2-dialog';dialog.setAttribute('aria-labelledby','r2DialogTitle');
    dialog.innerHTML=`<form><header><h3 id="r2DialogTitle">${esc(title)}</h3></header><div class="r2-form-body">${body}<p class="r2-message" role="status" aria-live="polite"></p></div><footer>${button('cancel','取消')}<button class="r2-button ${danger?'r2-danger':'r2-primary'}" type="submit">${label}</button></footer></form>`;
    document.body.appendChild(dialog);dialog.querySelector('[data-radar-action="cancel"]').onclick=()=>{if(!busy){closeDialog();render();}};
    dialog.oncancel=e=>{e.preventDefault();if(!busy){closeDialog();render();}};
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();if(!busy)onSubmit(new FormData(e.currentTarget));};
    dialog.showModal();resizeDialog();dialog.querySelector('input,textarea,select,button')?.focus();
  }
  function editDirection(record){
    const d=record?.data||{title:'',find:'',exclude:'',accountStage:'',enabled:true};
    const fields=[['title','方向名称'],['find','我要找什么'],['exclude','排除什么'],['accountStage','适用账号 / 当前内容阶段（可选）']];
    const html=fields.map(([key,label])=>`<label class="r2-field">${label}${key==='title'?`<input name="${key}" required value="${esc(d[key])}">`:`<textarea name="${key}" rows="2">${esc(d[key])}</textarea>`}</label>`).join('')+`<label class="r2-check"><input name="enabled" type="checkbox" ${d.enabled?'checked':''}>启用这个方向</label>`;
    openDialog(record?'编辑方向':'新增方向',html,form=>{const fields={title:form.get('title'),find:form.get('find'),exclude:form.get('exclude'),accountStage:form.get('accountStage'),enabled:form.has('enabled')};perform(()=>record?service.editDirection(record,fields):service.createDirection(fields));});
  }
  function editCandidate(record){
    const d=record.data,choices=current.directions.filter(r=>r.deletedAt===null),missing=d.directionId&&!choices.some(r=>r.id===d.directionId);
    const body=`<label class="r2-field">所属方向<select name="directionId"><option value="">未分类</option>${missing?`<option value="${esc(d.directionId)}" selected>${esc(directionLabel(d.directionId))}</option>`:''}${choices.map(r=>`<option value="${esc(r.id)}" ${r.id===d.directionId?'selected':''}>${esc(directionLabel(r.id))}</option>`).join('')}</select></label>
      ${d.status==='abandoned'?`<label class="r2-field">为什么没做（可选）<textarea name="abandonReason" rows="3">${esc(d.abandonReason)}</textarea></label>`:''}
      ${d.status==='adopted'?`<label class="r2-field">${d.madeVideoAt?'制作备注':'历史备注'}（可选）<textarea name="adoptNote" rows="3">${esc(d.adoptNote)}</textarea></label>`:''}`;
    openDialog('管理素材',body,form=>perform(()=>service.updateCandidate(record,{directionId:form.get('directionId')||null,...(form.has('abandonReason')?{abandonReason:form.get('abandonReason')}:{}),...(form.has('adoptNote')?{adoptNote:form.get('adoptNote')}:{} )})));
  }
  function click(event){
    const el=event.target.closest('button[data-radar-action]');if(!el||busy)return;const action=el.dataset.radarAction;
    if(['discover','candidates','manage'].includes(action)){mode=action;if(action==='candidates'){statusFilter='all';allCandidatesFilter='all';}notify('');render();return;}
    if(action==='open-sync'){root.switchTab('sync');return;}
    if(action==='status-view'){mode='candidates';statusFilter=el.dataset.status;notify('');render();return;}
    if(action==='direction-new'){editDirection();return;}
    const dirId=el.closest('[data-direction-id]')?.dataset.directionId,direction=current.directions.find(r=>r.id===dirId);
    if(direction){
      if(action==='direction-edit')editDirection(direction);
      else if(action==='direction-toggle')perform(()=>service.toggleDirection(direction));
      else if(action==='direction-up'||action==='direction-down')perform(()=>service.moveDirection(current,dirId,action==='direction-up'?-1:1));
      else if(action==='direction-delete')openDialog('确认删除方向',`<p>确定删除“${esc(direction.data.title)}”吗？已保存候选会保留。以后可能继续使用的方向，可以选择暂停。</p>`,()=>perform(()=>service.removeDirection(direction,true)),'确认删除',true);
      return;
    }
    const candidateId=el.closest('[data-candidate-id]')?.dataset.candidateId,record=current.candidates.find(r=>r.id===candidateId);
    if(record){
      if(action==='classify'){const status=el.dataset.classification,label={selected:'已归为：选题',considering:'已归为：待选',abandoned:'已 PASS'}[status];if(label)perform(()=>service.updateCandidate(record,{status}),label);}
      else if(action==='made-video')perform(()=>service.markMadeVideo(record),'已标记：做成视频');
      else if(action==='candidate-edit')editCandidate(record);return;
    }
    const generatedIndex=el.closest('[data-generated-index]')?.dataset.generatedIndex;
    if(action==='classify'&&generatedIndex!==undefined&&generatedFeed[+generatedIndex]){
      const status=el.dataset.classification,label={selected:'已归为：选题',considering:'已归为：待选',abandoned:'已 PASS'}[status];
      if(label)perform(()=>service.classifyGenerated(generatedFeed[+generatedIndex],status),label);return;
    }
  }
  function change(event){
    if(event.target.id!=='r2StatusFilter'||busy)return;
    const value=event.target.value;
    if(!ALL_CANDIDATE_FILTERS.some(([key])=>key===value))return;
    allCandidatesFilter=value;notify('');render();
  }
  function storageChanged(event){
    if(event.key!==null&&event.key!==root.WorkbenchDataV2.STORAGE_KEY)return;if(!active()||busy)return;
    if(dialog?.open)notify('另一页面的数据已变化。当前输入已保留，保存时会检查修订冲突。');else{notify('已读取最新选题数据');render();}
  }
  function resizeDialog(){if(dialog?.open)dialog.style.maxHeight=Math.max(160,(root.visualViewport?.height||root.innerHeight)-24)+'px';}
  async function mount(target){
    leave();host=target;service=Model.createService(root.WorkbenchDataV2.createStore(localStorage));mode='discover';statusFilter='all';allCandidatesFilter='all';message='';error=false;
    const combined=[...(Array.isArray(root.WORKBENCH_AUTO_TOPICS)?root.WORKBENCH_AUTO_TOPICS:[]),...(Array.isArray(root.WORKBENCH_GENERATED_TOPICS)?root.WORKBENCH_GENERATED_TOPICS:[])];
    const seen=new Set();generatedFeed=combined.filter(d=>{if(!d||typeof d.eventId!=='string'||seen.has(d.eventId))return false;seen.add(d.eventId);return true;}).map(d=>Adapter.generated(d));
    host.addEventListener('click',click);host.addEventListener('change',change);root.addEventListener('storage',storageChanged);root.visualViewport?.addEventListener('resize',resizeDialog);
    busy=true;render();
    try{const result=await service.importLegacy(localStorage.getItem('wb_hot_favs'));notify(result.added?`已从历史收藏导入 ${result.added} 条记录，原数据保留。`:'');}
    catch(e){notify('旧收藏暂未导入：'+e.message+'。原数据保留。',true);}
    finally{busy=false;render();}
  }
  function leave(){if(busy)return;closeDialog();if(host){host.removeEventListener('click',click);host.removeEventListener('change',change);}root.removeEventListener('storage',storageChanged);root.visualViewport?.removeEventListener('resize',resizeDialog);host=null;}
  root.WorkbenchRadarUI=Object.freeze({mount,leave,canLeave:()=>!busy});
})(window);
