(function(root){
  'use strict';
  const core=root.WorkbenchBackup,$=s=>document.querySelector(s);
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let host=null,plan=null,lastBackup=null,busy=false;
  function createSnapshotStore(){
    let connection;
    function db(){
      if(!root.indexedDB)return Promise.reject(new Error('无法持久保存恢复前快照，不写入业务数据'));
      if(!connection)connection=new Promise((resolve,reject)=>{
        const r=indexedDB.open('workbench-p0-safety',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('restoreSnapshots',{keyPath:'id'}).createIndex('createdAt','createdAt');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('无法打开快照存储'));
        r.onblocked=()=>reject(new Error('快照存储被其他页面阻塞'));
      });return connection;
    }
    return {
      async save(s){const d=await db();await new Promise((resolve,reject)=>{
        const t=d.transaction('restoreSnapshots','readwrite');t.objectStore('restoreSnapshots').put(s);
        t.oncomplete=resolve;t.onerror=()=>reject(new Error('快照保存失败'));t.onabort=t.onerror;
      });},
      async latest(){const d=await db();return new Promise((resolve,reject)=>{
        const r=d.transaction('restoreSnapshots','readonly').objectStore('restoreSnapshots').index('createdAt').openCursor(null,'prev');
        r.onsuccess=()=>resolve(r.result?r.result.value:null);r.onerror=()=>reject(new Error('快照读取失败'));
      });}
    };
  }
  const snapshots=createSnapshotStore();
  function message(text,error){const e=$('#p0Message');if(e){e.textContent=text;e.style.color=error?'#b42318':'#176845';}}
  function download(content,name){
    const u=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'})),a=document.createElement('a');
    a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
  }
  function table(summary,old){
    const show=r=>!r?'无法统计':r.present?JSON.stringify(r.counts):'无数据（键不存在）';
    return '<table class="p0-table"><tr><th>业务数据</th>'+(old?'<th>当前</th>':'')+'<th>'+(old?'将恢复':'数量')+'</th></tr>'+core.BUSINESS_KEYS.map(k=>
      '<tr><td>'+esc(core.LABELS[k])+'<br><small>'+k+'</small></td>'+(old?'<td>'+esc(show(old[k]))+'</td>':'')+'<td>'+esc(show(summary[k]))+'</td></tr>').join('')+'</table>';
  }
  function open(target){
    if(busy)return;
    plan=null;host=target||$('#modalBox')||$('#p0Root');if(!host)throw new Error('找不到保全容器');
    host.innerHTML=`<h3>P0 数据保全</h3><p><b>旧 Gist 同步仍暂停，现有配置保留。V2 同步请使用主导航「云端同步」，仅配置不会显示已同步。</b></p>
      <p>当前入口：<code>${esc(location.origin)}</code><br>完整业务备份包含${core.BUSINESS_KEYS.length}项，含新版项目、选题和收藏数据，不含API Key、GitHub Token或Cookie。</p>
      <div class="p0-actions"><button id="p0Export">完整导出 JSON</button><button id="p0Copy">复制完整备份</button><button id="p0Rollback">回滚上次恢复</button><button id="p0SnapshotExport">下载原始快照</button>${host.id==='modalBox'?'<button id="p0Close">关闭</button>':''}</div>
      <label>导入完整备份文件 <input id="p0File" type="file" accept=".json,application/json"></label>
      <textarea id="p0Input" rows="7" style="width:100%;box-sizing:border-box" placeholder="或粘贴schemaVersion=${core.SCHEMA_VERSION}的完整备份；读取和预览不会写入数据"></textarea>
      <div class="p0-actions"><button id="p0Preview">解析、校验并预览</button><button id="p0Confirm" disabled>确认恢复以上数据</button><button id="p0Cancel" disabled>取消预览</button></div>
      <p id="p0Message" role="status" aria-live="polite"></p><div id="p0PreviewArea"></div>
      <div class="p0-actions"><button id="p0Verify" disabled>再次核验数量和字段</button></div>
      <p>恢复前快照存于当前origin的IndexedDB。长期保留请下载并另存D盘项目“用户备份”目录。</p>`;
    if(host.id==='modalBox')$('#modal').classList.add('show');
    $('#p0Export').onclick=doExport;$('#p0Copy').onclick=doCopy;
    $('#p0Preview').onclick=()=>preview($('#p0Input').value);$('#p0Confirm').onclick=commit;$('#p0Cancel').onclick=cancel;
    $('#p0File').onchange=()=>{const f=$('#p0File').files[0];if(f)doImport(f);};
    $('#p0Rollback').onclick=rollback;$('#p0SnapshotExport').onclick=exportSnapshot;
    $('#p0Verify').onclick=verify;
    if($('#p0Close'))$('#p0Close').onclick=()=>{if(!busy&&typeof root.closeModal==='function')root.closeModal();};
    if(lastBackup)$('#p0Verify').disabled=false;
    message('尚未恢复或同步，请先导出或选择备份后预览。');
    snapshots.latest().then(s=>{if(s&&['prepared','rollback-required'].includes(s.status))message('检测到可能中断的恢复，快照仍保留。请检查数据，必要时回滚。',true);}).catch(()=>{});
  }
  function ensureOpen(){if(!host||!document.contains(host)||!$('#p0Message'))open();}
  function doExport(){ensureOpen();try{
    const b=core.createBackup(localStorage,location.origin);$('#p0PreviewArea').innerHTML=table(core.summarize(b.data));
    download(JSON.stringify(b,null,2),'workbench-business-v'+core.SCHEMA_VERSION+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    message('完整备份已校验并生成，请确认文件保存成功。没有上传或改写业务数据。');
  }catch(e){message(e.message,true);}}
  async function doCopy(){ensureOpen();try{
    const value=JSON.stringify(core.createBackup(localStorage,location.origin),null,2);
    if(navigator.clipboard&&navigator.clipboard.writeText){try{await navigator.clipboard.writeText(value);message('完整备份已复制，请另存D盘。');return;}catch(_){} }
    $('#p0Input').value=value;message('请复制文本框内的完整备份，另存D盘。');
  }catch(e){message(e.message,true);}}
  async function doImport(file){ensureOpen();try{const value=await file.text();$('#p0Input').value=value;preview(value);}catch(e){message(e.message,true);}}
  function preview(input){if(busy)return;ensureOpen();cancel();try{
    plan=core.prepareRestore(input,localStorage);
    $('#p0PreviewArea').innerHTML='<p>来源：<code>'+esc(plan.backup.sourceOrigin)+'</code><br>导出时间：'+esc(plan.backup.exportedAt)+'</p><p>确认后替换'+core.BUSINESS_KEYS.length+'项业务数据；null移除对应业务键。敏感配置和无关数据保持原样。</p>'+table(plan.incoming,plan.current);
    $('#p0Confirm').disabled=false;$('#p0Cancel').disabled=false;message('结构校验通过。仅预览，尚未写入，请核对清单后确认恢复。');
  }catch(e){message('未写入：'+e.message,true);}}
  function cancel(){plan=null;if($('#p0Confirm')){$('#p0Confirm').disabled=true;$('#p0Cancel').disabled=true;$('#p0PreviewArea').innerHTML='';message('预览已取消，没有写入数据。');}}
  async function commit(){
    if(!plan||busy)return;busy=true;const selected=plan;$('#p0Confirm').disabled=true;$('#p0Cancel').disabled=true;
    ['p0Preview','p0File','p0Rollback','p0Close','p0Input'].forEach(id=>{if($('#'+id))$('#'+id).disabled=true;});
    $('#p0Verify').disabled=true;
    message('正在保存恢复前快照，然后写入和逐字段核验……');
    try{
      const r=await core.applyRestore(selected,{confirmed:true,storage:localStorage,snapshots,sourceOrigin:location.origin,locks:navigator.locks});
      lastBackup=selected.backup;plan=null;
      let refreshFailed=false;
      if(typeof root.onP0Restored==='function')try{root.onP0Restored();}catch(_){refreshFailed=true;}
      $('#p0PreviewArea').innerHTML=table(r.counts);$('#p0Verify').disabled=false;
      message('恢复完成：'+core.BUSINESS_KEYS.length+'项业务键及全部字段与备份一致。恢复前快照已保存。'+(refreshFailed?' 页面显示更新失败，请手动刷新。':''));
    }catch(e){plan=null;lastBackup=null;message(e.message,true);}
    finally{busy=false;['p0Preview','p0File','p0Rollback','p0Close','p0Input'].forEach(id=>{if($('#'+id))$('#'+id).disabled=false;});}
  }
  function verify(){if(!lastBackup)return;try{
    const r=core.verifyBackup(lastBackup,localStorage,location.origin);$('#p0PreviewArea').innerHTML=table(r.counts,r.expected);
    message(r.equal?'核验通过：数量和全部字段一致。':'核验不一致，请检查或回滚。',!r.equal);return r;
  }catch(e){message(e.message,true);}}
  async function rollback(){ensureOpen();try{
    const s=await snapshots.latest();if(!s){message('当前入口没有恢复前快照。');return;}
    const b=core.backupFromSnapshot(s);$('#p0Input').value=JSON.stringify(b,null,2);preview(b);
    if(plan)message('已预览恢复前快照。确认恢复才会回滚；回滚前也保存当前状态。');
  }catch(e){message(e.message+'；可下载原始快照保留恢复前内容。',true);}}
  async function exportSnapshot(){ensureOpen();try{
    const s=await snapshots.latest();if(!s){message('没有恢复前快照。');return;}
    download(JSON.stringify(s,null,2),'workbench-restore-snapshot-'+s.id+'.json');message('原始快照已生成，请另存D盘；这不是普通业务导入格式。');
  }catch(e){message(e.message,true);}}
  root.WorkbenchSafetyUI=Object.freeze({open,doExport,doCopy,doImport,doPaste:()=>open(),snapshots});
})(window);
