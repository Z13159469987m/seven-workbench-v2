(function(root){
  'use strict';
  const Model=root.WorkbenchFavoritesModel,esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let host=null,service=null,current=null,view='inbox',query='',groupFilter='all',projectFilter='all',busy=false,dialog=null,message='',error=false;
  const btn=(action,label,extra='')=>`<button type="button" class="f3-button" data-fav-action="${action}" ${extra}>${label}</button>`;
  const active=()=>host?.querySelector('.f3-house');
  function notify(text,isError=false){message=text;error=isError;const el=dialog?.open?dialog.querySelector('.f3-message'):host?.querySelector('#f3Message');if(el){el.textContent=text;el.classList.toggle('f3-error',isError);}}
  function close(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
  function disable(value){for(const scope of [active(),dialog])scope?.querySelectorAll('button,input,textarea,select').forEach(el=>{if(value){el.dataset.f3Disabled=String(el.disabled);el.disabled=true;}else if(el.dataset.f3Disabled!==undefined){el.disabled=el.dataset.f3Disabled==='true';delete el.dataset.f3Disabled;}});}
  async function perform(action){if(busy)return;busy=true;disable(true);notify('正在保存…');try{await action();busy=false;disable(false);close();notify('已保存');render();}catch(e){busy=false;disable(false);notify(e.message+'。当前输入已保留。',true);}}
  function card(r){
    const d=r.data,url=Model.href(d.url),title=d.title||d.url;
    return `<article class="f3-card" data-favorite-id="${esc(r.id)}"><header><h3>${url?`<a class="f3-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`:esc(title)}</h3></header>
      <div class="f3-chips"><span class="f3-chip">${esc(d.source||'未知来源')}</span>${d.inbox?'<span class="f3-chip">待整理</span>':''}${d.origin==='legacy'?'<span class="f3-chip">旧收藏 · legacy</span>':''}<span class="f3-chip">${esc(service.groupLabel(current,d.groupId))}</span>${d.projectId?`<span class="f3-chip">${esc(service.projectLabel(current,d.projectId))}</span>`:''}</div>
      ${d.title?`<p class="f3-url">${esc(d.url)}</p>`:''}
      <section class="f3-summary"><h4>AI摘要</h4><p>${esc(d.summary||'暂未填写，可稍后补充')}</p></section>
      <section class="f3-note"><h4>我的备注</h4><p>${esc(d.note||'暂未填写')}</p></section>
      <div class="f3-chips">${d.tags.map(t=>`<span class="f3-chip"># ${esc(t)}</span>`).join('')}</div>
      <footer>${url?`<a class="f3-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开原文</a>`:'<span class="f3-muted">链接暂无法直接打开，可编辑补全</span>'}${btn('edit','整理 / 编辑')}${btn('inbox',d.inbox?'完成整理':'标为待整理')}${btn('delete','删除')}</footer></article>`;
  }
  function groupCard(r,index,total){const d=r.data;return `<article class="f3-group" data-group-id="${esc(r.id)}"><h3>${esc(d.name)}${d.archived?'（已归档）':''}</h3><p>${esc(d.description||'暂未填写说明')}</p><footer>${btn('group-open','查看收藏')}${btn('group-edit','编辑')}${btn('group-up','上移',index===0?'disabled':'')}${btn('group-down','下移',index===total-1?'disabled':'')}${btn('group-archive',d.archived?'恢复收藏夹':'归档')}${btn('group-delete','删除')}</footer></article>`;}
  function option(id,label,selected){return `<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(label)}</option>`;}
  function render(){
    if(!host)return;try{current=service.snapshot();}catch(e){host.innerHTML=`<section class="f3-house"><p role="alert">${esc(e.message)}。未改写收藏。</p></section>`;return;}
    const groups=current.groups.filter(r=>!r.deletedAt),searched=service.search(current,query);
    let rows=searched,tools='';
    if(!query.trim()){
      if(view==='inbox')rows=rows.filter(r=>r.data.inbox);
      if(view==='groups'){
        if(groupFilter!=='all')rows=rows.filter(r=>(r.data.groupId||'')===groupFilter);
        tools=`<div class="f3-group-list">${groups.map((r,i)=>groupCard(r,i,groups.length)).join('')||'<p class="f3-empty">还没有收藏夹，先收藏也可以。</p>'}</div><label class="f3-filter">查看收藏夹<select id="f3GroupFilter">${option('all','全部收藏夹',groupFilter)}${option('','未分类',groupFilter)}${groups.map(r=>option(r.id,service.groupLabel(current,r.id),groupFilter)).join('')}</select></label>`;
      }
      if(view==='projects'){
        rows=rows.filter(r=>projectFilter==='all'?r.data.projectId!==null:r.data.projectId===projectFilter);
        const ids=[...new Set([...current.projects.map(r=>r.id),...current.favorites.map(r=>r.data.projectId).filter(Boolean)])];
        tools=`<label class="f3-filter">关联项目<select id="f3ProjectFilter">${option('all','全部关联项目',projectFilter)}${ids.map(id=>option(id,service.projectLabel(current,id),projectFilter)).join('')}</select></label>`;
      }
    }else tools='<p class="f3-muted">搜索全部收藏，包括已整理和归档收藏夹中的内容。</p>';
    const focus=host.querySelector('#f3Search')===document.activeElement,selection=focus?host.querySelector('#f3Search').selectionStart:null;
    host.innerHTML=`<section class="f3-house" aria-label="收藏小屋"><header class="f3-toolbar"><p>先放进小屋，之后慢慢整理。</p><div>${btn('new','＋ 收藏')}${btn('group-new','＋ 收藏夹')}</div></header>
      <nav class="f3-tabs" aria-label="收藏视图">${Object.entries({inbox:'待整理',recent:'最近收藏',groups:'收藏夹',projects:'关联项目'}).map(([key,label])=>btn(key,label,`aria-pressed="${view===key}"`)).join('')}</nav>
      <label class="f3-search">搜索收藏<input id="f3Search" type="search" value="${esc(query)}" placeholder="标题、链接、摘要、备注、标签、收藏夹" autocomplete="off"></label>
      <p id="f3Message" class="f3-message ${error?'f3-error':''}" role="status" aria-live="polite">${esc(message)}</p>${tools}<div class="f3-list">${rows.map(card).join('')||'<p class="f3-empty">这里还没有收藏，点“＋ 收藏”保存一个链接。</p>'}</div></section>`;
    if(focus){const input=host.querySelector('#f3Search');input.focus();input.setSelectionRange?.(selection,selection);}if(busy)disable(true);
  }
  function resize(){if(dialog?.open)dialog.style.maxHeight=Math.max(160,(root.visualViewport?.height||innerHeight)-24)+'px';}
  function open(title,body,onSubmit,label='保存'){
    close();dialog=document.createElement('dialog');dialog.className='f3-dialog';dialog.setAttribute('aria-labelledby','f3DialogTitle');dialog.innerHTML=`<form><header><h3 id="f3DialogTitle">${esc(title)}</h3></header><div class="f3-form-body">${body}<p class="f3-message" role="status" aria-live="polite"></p></div><footer>${btn('cancel','取消')}<button class="f3-button f3-primary" type="submit">${label}</button></footer></form>`;document.body.appendChild(dialog);
    dialog.querySelector('[data-fav-action="cancel"]').onclick=()=>{if(!busy){close();render();}};dialog.oncancel=e=>{e.preventDefault();if(!busy){close();render();}};dialog.querySelector('form').onsubmit=e=>{e.preventDefault();if(!busy)onSubmit(new FormData(e.currentTarget));};dialog.showModal();resize();dialog.querySelector('input,textarea,select,button')?.focus();
  }
  function field(name,label,value='',area=false,extra=''){return `<label class="f3-field">${label}${area?`<textarea name="${name}" rows="3" ${extra}>${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}" ${extra}>`}</label>`;}
  function create(){open('收藏链接',field('url','链接','','','required inputmode="url" autocomplete="off" placeholder="粘贴链接"')+field('note','一句备注（可选）','',true),form=>perform(async()=>{await service.create(form.get('url'),form.get('note'));view='inbox';query='';}));}
  function edit(r){
    const d=r.data,groups=current.groups.filter(g=>!g.deletedAt),projects=current.projects.filter(p=>!p.deletedAt||p.id===d.projectId);
    const missingGroup=d.groupId&&!groups.some(g=>g.id===d.groupId),missingProject=d.projectId&&!projects.some(p=>p.id===d.projectId);
    open('整理收藏',field('url','链接',d.url,false,'required inputmode="url"')+field('title','标题（可选）',d.title)+field('source','平台 / 来源',d.source)+field('summary','AI摘要（可手动填写）',d.summary,true)+
      `<details class="f3-ai"><summary>可选：根据正文生成摘要</summary><p>只将你粘贴的正文发送给已配置的 AI，不自动抓取链接。生成后可检查再保存。</p>${field('aiBody','正文 / 要点','',true)}${btn('ai','生成摘要')}</details>`+field('note','我的备注',d.note,true)+field('tags','标签（用逗号或换行分隔）',d.tags.join('\n'),true)+
      `<label class="f3-field">收藏夹<select name="groupId">${option('','未分类',d.groupId||'')}${groups.map(g=>option(g.id,service.groupLabel(current,g.id),d.groupId)).join('')}</select></label>${missingGroup?'<p class="f3-muted">原收藏夹已不可用，保存后放回未分类。</p>':''}`+
      `<label class="f3-field">关联项目（可选）<select name="projectId">${option('','未关联项目',d.projectId||'')}${projects.map(p=>option(p.id,service.projectLabel(current,p.id),d.projectId)).join('')}${missingProject?option(d.projectId,'项目不可用（保留关联）',d.projectId):''}</select></label><label class="f3-check"><input type="checkbox" name="inbox" ${d.inbox?'checked':''}>待整理（完成后可取消）</label>`,form=>perform(()=>service.edit(r,{url:form.get('url'),title:form.get('title'),source:form.get('source'),summary:form.get('summary'),note:form.get('note'),tags:form.get('tags').split(/[,，\n]/),groupId:form.get('groupId')||null,projectId:form.get('projectId')||null,inbox:form.has('inbox')})));
    dialog.querySelector('[data-fav-action="ai"]').onclick=()=>generateSummary();
  }
  async function generateSummary(){
    const target=dialog,body=target.querySelector('[name="aiBody"]').value.trim(),summary=target.querySelector('[name="summary"]'),before=summary.value,button=target.querySelector('[data-fav-action="ai"]');
    if(!body){notify('请先粘贴正文或要点；也可以直接手动填写摘要。');return;}button.disabled=true;button.textContent='生成中…';
    try{const result=await root.callAI('根据用户提供的正文，用2～3句中文概括核心内容。只依据正文，不推测未提供的事实。',body);if(dialog===target&&target.open&&!busy){if(summary.value===before){summary.value=String(result).trim();notify('摘要已填入，请检查后保存。');}else notify('摘要输入已被修改，保留你的内容；可重新生成。');}}
    catch(_){if(dialog===target&&target.open)notify('摘要未能生成。收藏已保留，可以手动填写或稍后重试。',true);}
    finally{button.disabled=false;button.textContent='生成摘要';}
  }
  function editGroup(r){const d=r?.data||{name:'',description:''};open(r?'编辑收藏夹':'新建收藏夹',field('name','收藏夹名称',d.name,false,'required')+field('description','说明',d.description,true),f=>perform(()=>r?service.editGroup(r,{name:f.get('name'),description:f.get('description')}):service.createGroup({name:f.get('name'),description:f.get('description')})));}
  function click(e){
    const b=e.target.closest('button[data-fav-action]');if(!b||busy)return;const a=b.dataset.favAction;
    if(['inbox','recent','groups','projects'].includes(a)&&!b.closest('[data-favorite-id]')){view=a;query='';notify('');render();return;}
    if(a==='new'){create();return;}if(a==='group-new'){editGroup();return;}
    const g=current.groups.find(r=>r.id===b.closest('[data-group-id]')?.dataset.groupId);
    if(g){if(a==='group-edit')editGroup(g);else if(a==='group-open'){groupFilter=g.id;render();}else if(a==='group-archive')perform(()=>service.editGroup(g,{archived:!g.data.archived}));else if(a==='group-up'||a==='group-down')perform(()=>service.moveGroup(current,g.id,a==='group-up'?-1:1));else if(a==='group-delete')open('确认删除收藏夹',`<p>删除“${esc(g.data.name)}”？其中收藏会移回未分类和待整理，收藏内容不会删除。</p>`,()=>perform(async()=>{await service.removeGroup(g,true);groupFilter='all';}),'确认删除收藏夹');return;}
    const r=current.favorites.find(r=>r.id===b.closest('[data-favorite-id]')?.dataset.favoriteId);if(!r)return;
    if(a==='edit')edit(r);else if(a==='inbox')perform(()=>service.edit(r,{inbox:!r.data.inbox}));else if(a==='delete')open('确认删除收藏',`<p>确定删除“${esc(r.data.title||r.data.url)}”吗？</p>`,()=>perform(()=>service.remove(r,true)),'确认删除');
  }
  function input(e){if(e.target.id==='f3Search'&&!e.isComposing){query=e.target.value;render();}}
  function change(e){if(e.target.id==='f3GroupFilter'){groupFilter=e.target.value;render();}if(e.target.id==='f3ProjectFilter'){projectFilter=e.target.value;render();}}
  function storageChanged(e){if(e.key!==null&&e.key!==root.WorkbenchDataV2.STORAGE_KEY)return;if(!active()||busy)return;if(dialog?.open)notify('另一页面的数据已变化。输入已保留，保存时会检查修订冲突。');else{notify('已读取最新收藏');render();}}
  async function mount(target){leave();host=target;service=Model.createService(root.WorkbenchDataV2.createStore(localStorage));view='inbox';query='';groupFilter='all';projectFilter='all';message='';error=false;host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('compositionend',input);host.addEventListener('change',change);root.addEventListener('storage',storageChanged);root.visualViewport?.addEventListener('resize',resize);busy=true;render();try{const result=await service.importLegacy(localStorage.getItem('wb_favgroups'));notify(result.groups+result.favorites?`已兼容导入 ${result.groups} 个收藏夹、${result.favorites} 条收藏，旧数据保留。`:'');}catch(e){notify('旧收藏暂未导入：'+e.message+'。原数据保留。',true);}finally{busy=false;render();}}
  function leave(){if(busy)return;close();if(host){host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('compositionend',input);host.removeEventListener('change',change);}root.removeEventListener('storage',storageChanged);root.visualViewport?.removeEventListener('resize',resize);host=null;}
  root.WorkbenchFavoritesUI=Object.freeze({mount,leave,canLeave:()=>!busy});
})(window);
