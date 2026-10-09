(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./sync-model.js'),require('./sync-config.js'),require('./backup-core.js'));
  else root.WorkbenchSyncV2=factory(root.WorkbenchSyncModel,root.WorkbenchSyncConfig,root.WorkbenchBackup);
})(typeof self!=='undefined'?self:this,function(Model,Config,Backup){
  'use strict';
  const LOCK='workbench-v2-sync',clone=x=>JSON.parse(JSON.stringify(x));
  const LABELS={unconfigured:'未配置',checking:'正在检查',synced:'已同步',local:'本地有未同步修改',remote:'云端有较新版本',conflict:'发生冲突，需要处理',failure:'同步失败',empty:'云端还没有 V2 数据','first-existing':'首次发现云端 V2 数据，请确认'};
  function create({storage,locks,snapshots,baselines,transport,sourceOrigin,now=()=>new Date().toISOString(),onChange=()=>{}}){
    let state={status:'unconfigured',localChanged:false,remoteChanged:false,error:'',autoStopped:false},busy=false,preview=null,observedLocal=null;
    function emit(patch){state={...state,...patch};onChange(view());}
    function view(){
      let cfg;try{cfg=Config.publicInfo(Config.read(storage));}catch(_){}
      const shown=clone(state);
      if(shown.status==='synced'&&observedLocal!==null){
        try{if(Backup.canonical(local())!==observedLocal){shown.status='local';shown.localChanged=true;if(shown.changeCounts)shown.changeCounts.local=null;}}
        catch(_){shown.status='failure';shown.localChanged=true;shown.error='本地业务数据无法核验';}
      }
      return {...shown,config:cfg||null,busy,preview:preview?{kind:preview.kind,stage:preview.stage,total:preview.remote.heads.length,ready:preview.ready,diff:preview.diff,summary:preview.ready?Backup.summarize(preview.draft):null}:null};
    }
    function local(){return Backup.createBackup(storage,sourceOrigin).data;}
    function assertCfg(c){const n=Config.read(storage);if(!n||n.gistId!==c.gistId||n.token!==c.token||n.enabled!==true)throw new Error('同步配置已变化或未启用，请重新检查');}
    async function base(c){const b=await baselines.get(c.gistId);if(!b||b.versionId!==c.knownVersionId)return null;return Model.parse(b);}
    function commonBase(b,remote){
      if(!b||!remote.nodes[b.versionId]||!Model.equal(b,remote.nodes[b.versionId]))return null;
      function contains(id,seen=new Set()){
        if(id===b.versionId)return true;if(seen.has(id))return false;seen.add(id);
        return remote.nodes[id].parents.some(p=>contains(p,seen));
      }
      return remote.heads.every(h=>contains(h.versionId))?b:null;
    }
    async function acknowledge(c,e){await baselines.set(c.gistId,e);Config.acknowledged(storage,c,e,now());}
    function summary(c,remote,b,l){
      let comparison=remote.heads.length>1?{status:'conflict',localChanged:!b||!Model.equal(l,b.state),remoteChanged:true,hasBase:!!b}:Model.status(l,remote.heads[0]||null,b);
      if(b&&!remote.heads.length)comparison={status:'conflict',localChanged:!Model.equal(l,b.state),remoteChanged:true,hasBase:true};
      if(b&&remote.heads.length&&!commonBase(b,remote))comparison={status:'conflict',localChanged:!Model.equal(l,b.state),remoteChanged:true,hasBase:false};
      let changeCounts={local:null,remote:null,conflicts:null,branches:remote.heads.length};
      if(b&&remote.heads.length===1&&commonBase(b,remote)){
        const x=Model.diff(b.state,l,remote.heads[0].state).counts;
        changeCounts={local:x.localAdded+x.localUpdated+x.localDeleted,remote:x.remoteAdded+x.remoteUpdated+x.remoteDeleted,conflicts:x.conflicts,branches:1};
        if(comparison.localChanged&&changeCounts.local===0)changeCounts.local=null;
        if(comparison.remoteChanged&&changeCounts.remote===0)changeCounts.remote=null;
      }
      observedLocal=Backup.canonical(l);
      return {...comparison,changeCounts,checkedAt:now(),localSummary:Backup.summarize(l),localUpdatedAt:l.wb_v2_state?.updatedAt||null,remote:remote.heads.map(e=>({versionId:e.versionId,syncVersion:e.syncVersion,updatedAt:e.updatedAt,sourceDeviceId:e.sourceDeviceId,summary:Backup.summarize(e.state)})),versionCount:remote.versionCount};
    }
    async function inspect(c){
      assertCfg(c);const remote=await transport.read(c),b=await base(c),l=local();assertCfg(c);
      const result=summary(c,remote,b,l);emit(result);return {...result,c,remote,base:b,local:l};
    }
    async function snapshot(reason,expected){
      const b=Backup.createBackup(storage,sourceOrigin);if(expected&&!Model.equal(b.data,expected))throw new Error('本地数据在预览后变化，请重新预览');
      const rawData=Object.fromEntries(Backup.BUSINESS_KEYS.map(k=>[k,storage.getItem(k)]));
      const s={snapshotVersion:1,id:'sync-'+globalThis.crypto.randomUUID(),createdAt:now(),sourceOrigin,status:'sync-'+reason,rawData,incomingSummary:Backup.summarize(b.data)};
      await snapshots.save(s);if(!Model.equal(local(),b.data))throw new Error('快照期间本地发生变化，已停止操作');return s;
    }
    async function run(fn){
      if(busy)throw new Error('同步操作正在进行');if(!locks?.request){const e=new Error('同步需要支持Web Locks的HTTPS或localhost入口');emit({status:'failure',error:e.message,autoStopped:true});throw e;}
      busy=true;emit({status:'checking',error:''});
      try{return await locks.request(LOCK,fn);}
      catch(e){preview=null;let dirty=true;try{const c=Config.read(storage),b=c?await base(c):null;dirty=!b||!Model.equal(local(),b.state);}catch(_){}
        emit({status:e.code==='branch'||e.code==='changed'?'conflict':'failure',error:e.code?e.message:(e.message||'同步失败'),localChanged:dirty,autoStopped:true});throw e;
      }finally{busy=false;onChange(view());}
    }
    function configured(){const c=Config.read(storage);if(!c?.enabled){emit({status:'unconfigured',error:'',remote:[]});return null;}return c;}
    async function upload(c,remote,data){
      await snapshot('upload',data);assertCfg(c);
      const env=await Model.envelope(data,{syncVersion:remote.heads.length?Math.max(...remote.heads.map(e=>e.syncVersion))+1:1,parents:remote.heads.map(e=>e.versionId),sourceDeviceId:c.deviceId,sourceOrigin,updatedAt:now()});
      const after=await transport.publish(c,env,remote.signature);assertCfg(c);await acknowledge(c,env);
      emit({...summary(c,after,env,local()),error:'',autoStopped:false});return env;
    }
    async function check(){return run(async()=>{preview=null;const c=configured();if(!c)return;const info=await inspect(c);if(info.status==='synced'){await acknowledge(c,info.remote.heads[0]);emit({...summary(c,info.remote,info.remote.heads[0],local()),error:'',autoStopped:false});}return view();});}
    async function sync({auto=false}={}){return run(async()=>{
      preview=null;const c=configured();if(!c)return;const info=await inspect(c);
      if(auto&&(!c.safeAutoUpload||state.autoStopped))return view();
      if(info.status==='local'&&info.base&&info.remote.heads.length===1&&info.remote.heads[0].versionId===info.base.versionId)return upload(c,info.remote,info.local);
      if(info.status==='synced'){await acknowledge(c,info.remote.heads[0]);emit({...summary(c,info.remote,info.remote.heads[0],local()),autoStopped:false});return view();}
      if(auto)emit({autoStopped:true,error:'自动上传已停止，请查看云端版本或冲突。'});return view();
    });}
    async function prepare(kind){return run(async()=>{
      const c=configured();if(!c)throw new Error('请先配置并启用V2同步');const info=await inspect(c);
      if(kind==='initial'&&(info.remote.heads.length||info.base))throw new Error('首次上传条件已变化，请重新检查');
      if(['pull','merge','local'].includes(kind)&&!info.remote.heads.length)throw new Error('云端没有可用V2版本');
      if(kind==='pull'&&info.remote.heads.length!==1)throw new Error('云端有多个分支，请逐条合并，不能直接覆盖本地');
      if(!['initial','pull','merge','local'].includes(kind))throw new Error('未知同步操作');
      await snapshot('preview',info.local);
      preview={kind,c,remote:info.remote,base:commonBase(info.base,info.remote),local:info.local,draft:kind==='pull'?clone(info.remote.heads[0].state):clone(info.local),stage:0,ready:kind!=='merge',diff:null};
      if(kind==='merge')preview.diff=Model.diff(preview.base?.state||null,preview.draft,info.remote.heads[0].state);
      onChange(view());return view();
    });}
    function advance(choices){
      if(busy||!preview||preview.kind!=='merge'||preview.ready)throw new Error('当前没有待处理差异');
      preview.draft=Model.resolve(preview.diff,choices,now());preview.stage++;
      if(preview.stage===preview.remote.heads.length){preview.ready=true;preview.diff=null;}
      else preview.diff=Model.diff(preview.base?.state||null,preview.draft,preview.remote.heads[preview.stage].state);
      onChange(view());return view();
    }
    async function confirm(confirmed){
      if(confirmed!==true)throw new Error('需要用户明确确认');const plan=preview;if(!plan?.ready)throw new Error('请先完成预览和冲突选择');
      return run(async()=>{
        assertCfg(plan.c);if(!Model.equal(local(),plan.local))throw new Error('本地数据在预览后变化，请重新预览');
        const fresh=await transport.read(plan.c);if(fresh.signature!==plan.remote.signature){const e=new Error('云端在预览后变化，请重新预览');e.code='changed';throw e;}
        if(plan.kind==='initial'||plan.kind==='local'){preview=null;return upload(plan.c,fresh,plan.local);}
        const backup={schemaVersion:2,exportedAt:now(),sourceOrigin,data:plan.draft};
        await locks.request('workbench-v2-business',async()=>{
          if(!Model.equal(local(),plan.local))throw new Error('远端检查期间本地数据变化，请重新预览');
          const heldLocks={request:(_name,fn)=>fn()},options={confirmed:true,storage,snapshots,sourceOrigin,locks:heldLocks};
          const restore=Backup.prepareRestore(backup,storage);
          await Backup.applyRestore(restore,options);
          preview=null;
          if(plan.kind==='pull')try{
            const after=await transport.read(plan.c);assertCfg(plan.c);await acknowledge(plan.c,fresh.heads[0]);
            emit({...summary(plan.c,after,fresh.heads[0],local()),error:'',autoStopped:false});
          }catch(e){
            if(Model.equal(local(),plan.draft)){
              try{await Backup.applyRestore(Backup.prepareRestore({...backup,data:plan.local},storage),options);e.rolledBack=true;e.message+='；已回滚到拉取前数据';}
              catch(_){e.message+='；自动回滚失败，请从数据保全恢复操作前快照';}
            }else e.message+='；期间新增的本地修改已保留，请检查快照';
            throw e;
          }
        });
        if(plan.kind==='pull')return view();
        return upload(plan.c,fresh,plan.draft);
      });
    }
    function cancel(){if(busy)return;preview=null;onChange(view());}
    async function configure(input){return run(async()=>{preview=null;Config.save(storage,input);emit({status:'unconfigured',remote:[],error:'配置已保存，尚未核验同步',autoStopped:false});return view();});}
    async function detectLocal(){
      if(busy)return view();const c=Config.read(storage);if(!c?.enabled)return view();const b=await base(c),l=local(),dirty=!b||!Model.equal(l,b.state);
      if(busy||Config.read(storage)?.gistId!==c.gistId)return view();
      const previousCount=state.changeCounts?.local,changed=dirty!==state.localChanged;state.localChanged=dirty;
      if(state.changeCounts&&b&&state.changeCounts.branches===1){const x=Model.diff(b.state,l,b.state).counts,n=x.localAdded+x.localUpdated+x.localDeleted;state.changeCounts={...state.changeCounts,local:dirty&&n===0?null:n};}
      if(dirty&&['synced','local'].includes(state.status))state.status='local';if(changed||previousCount!==state.changeCounts?.local)onChange(view());return view();
    }
    return Object.freeze({view,check,sync,prepare,advance,confirm,cancel,configure,detectLocal,local});
  }
  return Object.freeze({LOCK,LABELS,create});
});
