(function(root){
  'use strict';
  const Backup=root.WorkbenchBackup,Config=root.WorkbenchSyncConfig,Model=root.WorkbenchSyncModel;
  const manualOnly=!!document.querySelector('meta[name="workbench-deployment"][content="github-pages-v2"]');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let host=null,controller=null,editing=false,notice='',autoTimer=null,fingerprint=null,snapshotChoices=[];
  async function listSnapshots(){
    // Read the existing P0 store; never maintain a second copy of business snapshots.
    await root.WorkbenchSafetyUI.snapshots.latest(); // Let P0 own schema creation.
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('workbench-p0-safety',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('无法读取快照'));});
    try{return await new Promise((resolve,reject)=>{if(!db.objectStoreNames.contains('restoreSnapshots'))return resolve([]);const r=db.transaction('restoreSnapshots').objectStore('restoreSnapshots').getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));r.onerror=()=>reject(new Error('快照读取失败'));});}finally{db.close();}
  }
  function baselineStore(){
    let connection;
    async function db(){
      if(!connection)connection=new Promise((resolve,reject)=>{
        const r=indexedDB.open('workbench-v2-sync',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('baselines');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('无法读取同步基线'));r.onblocked=()=>reject(new Error('同步基线被其他页面阻塞'));
      });return connection;
    }
    return {async get(id){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('baselines').objectStore('baselines').get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(new Error('同步基线读取失败'));});},
      async set(id,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('baselines','readwrite');t.objectStore('baselines').put(value,id);t.oncomplete=resolve;t.onerror=()=>reject(new Error('同步基线保存失败'));t.onabort=t.onerror;});}};
  }
  const time=v=>{if(!v)return '尚无记录';const d=new Date(v),pad=n=>String(n).padStart(2,'0');return Number.isNaN(d.getTime())?'时间未知':`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;};
  function button(action,text,disabled=false){return `<button type="button" data-sync-action="${action}" ${disabled?'disabled':''}>${text}</button>`;}
  function counts(s){if(!s)return '';return '<dl class="s3-counts">'+Backup.BUSINESS_KEYS.map(k=>`<div><dt>${esc(Backup.LABELS[k])}</dt><dd>${s[k]?.present?Object.entries(s[k].counts).map(([n,v])=>esc(n)+': '+esc(typeof v==='object'?Object.entries(v).map(([a,b])=>a+' '+b).join(' / '):v)).join(' · '):'无数据'}</dd></div>`).join('')+'</dl>';}
  function fields(value){
    if(value===null)return '<p>没有此记录（不等同于删除标记）</p>';
    const labels={name:'名称',title:'标题',statusText:'当前状态',progressText:'进度',planText:'打算',plan:'打算',todos:'待做清单',text:'内容',done:'已完成',order:'排序',archived:'已归档',find:'我要找什么',exclude:'排除什么',accountStage:'账号 / 阶段',enabled:'启用',url:'原文链接',summary:'摘要',note:'我的备注',notes:'备注',tags:'标签',groupId:'收藏夹 ID',projectId:'关联项目 ID',inbox:'待整理',status:'状态',abandonReason:'放弃原因',adoptionNote:'采用备注',adoptNote:'采用备注',reason:'为什么适合',angle:'改编角度',example:'内容雏形',sources:'来源'};
    const rows=[];function walk(v,path){
      if(v!==null&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(k.endsWith('SchemaVersion'))continue;walk(x,path?path+' / '+(labels[k]||k):(labels[k]||k));}
      else rows.push(`<div><dt>${esc(path||'内容')}</dt><dd>${esc(v===null?'无':v)}</dd></div>`);
    }walk(value.data||value,'');return '<dl class="s3-fields">'+rows.join('')+'</dl>'+(value.data?`<details><summary>修订 ${esc(value.revision)} · ${value.deletedAt?'已删除':'有效记录'}</summary><p>ID：${esc(value.id)}<br>创建：${esc(time(value.createdAt))}<br>修改：${esc(time(value.updatedAt))}${value.deletedAt?'<br>删除：'+esc(time(value.deletedAt)):''}</p></details>`:'');
  }
  function difference(p){
    const d=p.diff,c=d.counts;
    return `<p>分支 ${p.stage+1} / ${p.total}。${d.hasBase?'使用双方共同基线比较。':'没有可证明的共同基线；不按时间或修订号猜测胜负。'}</p>
      <p>本地新增 ${c.localAdded} · 云端新增 ${c.remoteAdded} · 本地更新 ${c.localUpdated} · 云端更新 ${c.remoteUpdated} · 本地删除 ${c.localDeleted} · 云端删除 ${c.remoteDeleted}<br>建议保留 / 合并 ${c.safe} · 冲突 ${c.conflicts} · 无法判断 ${c.uncertain}</p>`+
      d.entries.map((e,i)=>`<details class="s3-entry" ${e.conflict?'open':''}><summary>${esc(e.collection?({projects:'项目',topics:'选题',favorites:'收藏',favoriteGroups:'收藏夹'}[e.collection]):Backup.LABELS[e.key])}：${esc(e.local?.data?.name||e.local?.data?.title||e.remote?.data?.name||e.remote?.data?.title||e.id||'业务项')} · ${e.conflict?'需要选择':'建议保留'+(e.choice==='local'?'本地':'云端')}</summary>
      <p>${esc([e.localChange,e.remoteChange,e.reason].filter(Boolean).join(' · '))}</p><div class="s3-sides"><section><h4>${p.stage?'上一步确认的本地草案':'本地版本'}</h4>${fields(e.local)}</section><section><h4>云端版本</h4>${fields(e.remote)}</section></div>
      ${e.conflict?`<fieldset><legend>明确保留哪一份</legend><label><input type="radio" name="choice-${i}" value="local"> 保留本地</label><label><input type="radio" name="choice-${i}" value="remote"> 保留云端</label></fieldset>`:''}</details>`).join('')+button('advance','生成建议结果（尚不写入）');
  }
  function preview(p,busy){
    if(!p)return '';
    const titles={initial:'首次上传确认',pull:'使用云端覆盖本地：确认预览',local:'使用本地覆盖云端：确认预览',merge:'逐条比较与合并'};
    return `<section class="s3-preview"><h3>${titles[p.kind]}</h3><p>当前本地完整业务快照已保存。确认前没有改写业务数据。</p>`+
      (!p.ready?difference(p):`<p>${p.kind==='pull'?'确认后替换当前入口全部业务数据。':p.kind==='local'?'确认后以本地数据建立新的云端版本，其他云端分支的改动可能不进入新版本。历史版本仍保留。':p.kind==='merge'?'确认后将建议结果写入本地并上传新版本。网络失败会保留本地合并结果。':'确认后创建首个云端 V2 版本。'}</p><details><summary>将应用的数据数量</summary>${counts(p.summary)}</details>
      ${['local','pull'].includes(p.kind)?'<label class="s3-consent"><input type="checkbox" id="s3Risk"> 我已核对双方版本、时间和数量，确认执行此覆盖操作</label>':''}
      ${button('confirm',p.kind==='merge'?'确认应用安全合并':p.kind==='initial'?'确认首次上传':'再次确认执行',busy)}`)+button('cancel','取消预览',busy)+'</section>';
  }
  function configForm(v){return `<form id="s3Config" class="s3-config"><h3>当前入口的同步配置</h3>
    <label>Gist ID<input name="gistId" required autocomplete="off" value="${esc(v.config?.gistId||'')}"></label>
    <label>GitHub Token<input name="token" type="password" autocomplete="new-password" placeholder="${v.config?.hasToken?'已保存，留空保持原 Token':'输入具有 Gist 权限的 Token'}"></label>
    <label class="s3-consent"><input name="enabled" type="checkbox" ${v.config?.enabled?'checked':''}> 启用 V2 同步检查</label>
    ${manualOnly?'<p>在线版仅支持手动同步；不会自动上传业务数据。</p>':`<label class="s3-consent"><input name="safeAutoUpload" type="checkbox" ${v.config?.safeAutoUpload?'checked':''}> 安全自动上传（默认关闭）</label><p>自动上传只在已建立基线、云端未变且数据通过校验时进行；出现冲突或错误会停止。启动只检查。</p>`}
    <div class="s3-actions"><button type="submit">保存配置</button>${button('legacy','确认复用旧 Gist 配置')}${button('configCancel','取消')}</div></form>`;}
  function verification(v){
    const head=v.remote?.length===1?v.remote[0]:null,c=v.changeCounts||{};
    const confirmed=v.status==='synced'&&!v.busy&&!!v.checkedAt&&!!head&&v.config?.knownVersionId===head.versionId&&c.local===0&&c.remote===0&&c.conflicts===0;
    const current=v.busy?'正在读取或核验云端；完成前不确认一致':confirmed?'云端已保存 · 当前本地与云端一致':v.status==='local'?'本地有修改，尚未保存到云端':v.status==='remote'?'云端有变化，当前本地尚未拉取':v.status==='conflict'?'存在冲突，不能确认两端一致':'尚未确认本地与云端一致';
    const readable=v.checkedAt&&!v.busy&&!['unconfigured','failure'].includes(v.status);
    const count=(key,changed)=>!readable?'未核验':Number.isSafeInteger(c[key])?`${c[key]} 项`:changed?'有变化 · 条目数待核对':'待核对';
    const conflict=readable&&Number.isSafeInteger(c.conflicts)?`${c.conflicts} 项`:readable&&c.branches>1?`${c.branches} 个分支 · 条目数待比较`:'未核验';
    return `<div class="s3-confirmation ${confirmed?'s3-confirmed':''}"><strong>${esc(current)}</strong><p>最近一次成功同步／核验：${esc(time(v.config?.lastSuccessAt))}<br>最近一次云端读取核验：${esc(time(v.checkedAt))}${head?`<br>当前云端版本写入：${esc(time(head.updatedAt))}`:''}</p>
      ${confirmed?`<p>已核验版本：<code>${esc(head.versionId.slice(0,12))}</code> · 完整版本 ID 可在下方“云端”查看。</p>`:''}
      <div class="s3-change-counts"><span>本地未同步修改：<b>${esc(count('local',v.localChanged))}</b></span><span>云端未拉取变化：<b>${esc(count('remote',v.remoteChanged))}</b></span><span>冲突：<b>${esc(conflict)}</b></span></div>
      <p class="s3-count-hint">数量按业务记录或业务键与已确认基线比较；无共同基线或多分支时不猜测条目数。</p></div>`;
  }
  function render(){
    if(!host||!document.contains(host)||editing||!document.querySelector('.nav-item.active[data-tab="sync"]'))return;const v=controller.view();
    host.innerHTML=`<section class="s3-sync"><h2>☁️ 云端同步</h2><div class="s3-status" role="status" aria-live="polite"><strong>${esc(root.WorkbenchSyncV2.LABELS[v.status])}</strong>
      <p>状态以最近一次读取核验为准。</p>${verification(v)}</div>
      ${v.error?`<p class="s3-error" role="alert">${esc(v.error)}${v.localChanged?'；本地仍有未同步修改。':''}</p>`:''}${v.autoStopped?'<p>安全自动上传已停止。请手动检查并处理，成功核验后恢复。</p>':''}
      <p id="s3Notice" role="status">${esc(notice)}</p><div class="s3-actions">${button('sync','立即同步',v.busy)}${button('check','重新检查云端',v.busy)}${button('config','配置',v.busy)}${button('backup','完整 JSON 备份 / 快照',v.busy)}</div>
      <p>当前入口：<code>${esc(location.origin)}</code><br>换域名或浏览器后，Token 不会自动继承。请重新填写 Gist ID 和 Token，再预览恢复业务数据。</p>
      <div class="s3-versions"><section><h3>本地</h3><p>最近 V2 业务更新：${esc(time(v.localUpdatedAt))}<br>上次确认云端版本：${esc(v.config?.knownSyncVersion??'尚无')}<br>设备：<code>${esc(v.config?.deviceId||'配置时建立')}</code></p><details><summary>本地数据数量</summary>${counts(v.localSummary)}</details></section>
      <section><h3>云端</h3>${v.remote?.length?v.remote.map(r=>`<p>版本 ${r.syncVersion} · ${esc(time(r.updatedAt))}<br><code>${esc(r.versionId)}</code><br>来源设备：<code>${esc(r.sourceDeviceId)}</code></p><details><summary>此分支数据数量</summary>${counts(r.summary)}</details>`).join(''):'<p>尚未读取到 V2 版本</p>'}</section></div>
      ${v.status==='empty'?button('initial','将当前本地数据作为首次云端版本',v.busy):''}
      ${v.remote?.length&&!v.preview?`<div class="s3-actions">${button('merge','查看差异 / 应用合并',v.busy)}</div><details class="s3-advanced"><summary>高级覆盖操作</summary><p>覆盖可能舍弃另一侧尚未同步的修改。请先核对上方版本、时间与数量；操作前保存完整快照，第二步需要再次确认。</p>${button('pull','预览：使用云端覆盖本地',v.busy||v.remote.length!==1)}${button('local','预览：使用本地覆盖云端',v.busy)}</details>`:''}
      ${preview(v.preview,v.busy)}<div id="s3ConfigSlot"></div><details><summary>操作前快照与回滚</summary><p>选择操作前的时间和数据摘要，进入 P0 预览后再次确认才会恢复。快照仅在当前浏览器和入口保存。</p>${button('snapshots','读取已有快照',v.busy)}<div id="s3Snapshots"></div></details><p class="s3-foot">旧同步保持暂停；旧云端文件与旧配置保留。V2 使用独立版本文件保留并发分支，不会自动选择一个分支覆盖另一个。<br>已读取不可变版本：${esc(v.versionCount??'尚未检查')} / ${root.WorkbenchSyncGist.MAX_VERSIONS}。达到本版上限后停止上传，保留全部历史。</p></section>`;
    host.querySelectorAll('[data-sync-action]').forEach(b=>b.onclick=()=>act(b.dataset.syncAction));
    if(v.preview?.ready&&['local','pull'].includes(v.preview.kind)){
      const c=host.querySelector('[data-sync-action="confirm"]');c.disabled=true;
      host.querySelector('#s3Risk').onchange=e=>{c.disabled=!e.target.checked||v.busy;};
    }
  }
  async function attempt(fn){notice='';try{await fn();}catch(e){notice=e.message||'操作失败，请检查后重试';}render();}
  async function act(action){
    if(action==='backup'){controller.cancel();root.openSyncModal();return;}
    if(action==='snapshots'){
      try{snapshotChoices=await listSnapshots();const slot=host.querySelector('#s3Snapshots');slot.innerHTML=snapshotChoices.length?snapshotChoices.map((s,i)=>`<details><summary>${esc(time(s.createdAt))} · ${esc(s.status)}</summary>${counts(Backup.summarize(Backup.backupFromSnapshot(s).data))}<button type="button" data-snapshot="${i}">预览恢复此快照</button></details>`).join(''):'<p>当前入口尚无快照。</p>';
        slot.querySelectorAll('[data-snapshot]').forEach(b=>b.onclick=async()=>{controller.cancel();const data=Backup.backupFromSnapshot(snapshotChoices[+b.dataset.snapshot]);root.openSyncModal();await root.WorkbenchSafetyUI.doImport(new Blob([JSON.stringify(data)],{type:'application/json'}));});
      }catch(e){notice=e.message;render();}return;
    }
    if(action==='config'){
      editing=true;host.querySelector('#s3ConfigSlot').innerHTML=configForm(controller.view());
      const form=host.querySelector('#s3Config');form.querySelector('[name=gistId]').focus();
      form.querySelectorAll('[data-sync-action]').forEach(b=>b.onclick=()=>act(b.dataset.syncAction));
      form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));
        form.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{await controller.configure({...data,enabled:data.enabled==='on',safeAutoUpload:!manualOnly&&data.safeAutoUpload==='on'});editing=false;notice='配置已保存。先检查云端，不会自动恢复。';render();await attempt(()=>controller.check());}
        catch(e){form.querySelectorAll('button').forEach(b=>b.disabled=false);host.querySelector('#s3Notice').textContent=e.message;}
      };return;
    }
    if(action==='configCancel'){editing=false;render();return;}
    if(action==='legacy'){
      if(!root.confirm('只复用旧 Gist ID 和 Token，不启用旧同步。确认读取到当前配置表单？'))return;
      try{const c=Config.legacy(localStorage,true),f=host.querySelector('#s3Config');f.elements.gistId.value=c.gistId;f.elements.token.value=c.token;f.elements.enabled.checked=false;if(!manualOnly)f.elements.safeAutoUpload.checked=false;}
      catch(e){host.querySelector('#s3Notice').textContent=e.message;}return;
    }
    await attempt(async()=>{
      if(action==='check'||action==='sync')await controller[action]();
      else if(['initial','pull','local','merge'].includes(action))await controller.prepare(action);
      else if(action==='advance'){const choices={};host.querySelectorAll('input[type=radio]:checked').forEach(n=>choices[n.name.slice(7)]=n.value);controller.advance(choices);}
      else if(action==='cancel')controller.cancel();
      else if(action==='confirm'){
        const kind=controller.view().preview?.kind;
        if(['local','pull'].includes(kind)&&!host.querySelector('#s3Risk')?.checked)throw new Error('请先确认覆盖风险');
        try{await controller.confirm(true);}finally{
          // Existing reload hook refreshes cached legacy data; remount only after it returns.
          if(['pull','merge'].includes(kind)&&typeof root.onP0Restored==='function'){root.onP0Restored();root.switchTab('sync');}
        }
        notice='操作已完成，请以当前核验状态为准。';
      }
    });
  }
  function boot(){
    if(controller)return;
    controller=root.WorkbenchSyncV2.create({storage:localStorage,locks:navigator.locks,snapshots:root.WorkbenchSafetyUI.snapshots,baselines:baselineStore(),transport:root.WorkbenchSyncGist.create(),sourceOrigin:location.origin,onChange:render});
    try{fingerprint=Backup.canonical(controller.local());const c=Config.read(localStorage);if(c?.enabled)controller.check().catch(()=>{});}catch(e){notice=e.message;}
    setInterval(async()=>{try{
      const v=await controller.detectLocal(),next=Backup.canonical(controller.local());
      if(next!==fingerprint){fingerprint=next;clearTimeout(autoTimer);
        if(!manualOnly&&v.config?.enabled&&v.config.safeAutoUpload&&!v.autoStopped&&v.status==='local')autoTimer=setTimeout(()=>controller.sync({auto:true}).catch(()=>{}),5000);
      }
    }catch(_){clearTimeout(autoTimer);}},2000);
  }
  function canLeave(){if(!controller||!host||!document.querySelector('.nav-item.active[data-tab="sync"]'))return true;if(controller.view().busy)return false;if(editing||controller.view().preview){if(!root.confirm('离开会取消未提交的同步配置或预览，业务数据保持原样。继续？'))return false;editing=false;controller.cancel();}return true;}
  root.WorkbenchSyncUI=Object.freeze({boot,mount(target){boot();host=target;render();},leave(){host=null;editing=false;},canLeave});
})(window);
