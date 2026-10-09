/* P0 business backup and transactional restore. No network or credential access. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./v2-data-core.js'));
  else root.WorkbenchBackup=factory(root.WorkbenchDataV2);
})(typeof self!=='undefined'?self:this,function(V2){
  'use strict';
  const SCHEMA_VERSION=2;
  const BUSINESS_KEYS=Object.freeze(['wb_marks','wb_weeks','wb_lab','wb_favgroups',
    'wb_potions','wb_hot_favs','wb_potion_overrides','wb_rock_logs','wb_rock_plan',
    'wb_rock_flows','wb_hidden_quotes','wb_lab_checkin','wb_skip_log_modal','wb_v2_state']);
  const SENSITIVE_KEYS=Object.freeze(['wb_ai_settings','wb_sync_cfg','wb_sync_v2_cfg']);
  const LABELS=Object.freeze({wb_marks:'日报收藏／高亮',wb_weeks:'周打卡／子任务',
    wb_lab:'实验流程／运营数据',wb_favgroups:'收藏小屋',wb_potions:'灵感',
    wb_hot_favs:'选题收藏',wb_potion_overrides:'魔药编辑结果',wb_rock_logs:'打卡日志',
    wb_rock_plan:'计划',wb_rock_flows:'工作流程',wb_hidden_quotes:'语录偏好',
    wb_lab_checkin:'实验田打卡',wb_skip_log_modal:'日志弹窗偏好',wb_v2_state:'新项目／选题／收藏数据'});
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  function fail(message){throw new Error(message);}
  function need(ok,path,type){if(!ok)fail(path+'：应为'+type);}
  function text(v,p){need(typeof v==='string',p,'字符串');}
  function bool(v,p){need(typeof v==='boolean',p,'布尔值');}
  function number(v,p){need(typeof v==='number'&&Number.isFinite(v)&&v>=0,p,'非负有限数字');}
  function obj(v,p){need(object(v),p,'对象');}
  function list(v,p){need(Array.isArray(v),p,'数组');}
  function fields(v,p,spec){obj(v,p);for(const k of Object.keys(spec))if(own(v,k))spec[k](v[k],p+'.'+k);}
  function stringList(v,p){list(v,p);v.forEach((x,i)=>text(x,p+'['+i+']'));}
  function date(v,p){
    text(v,p);const d=new Date(v+'T00:00:00Z');
    need(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(d)&&d.toISOString().slice(0,10)===v,p,'有效日期');
  }
  // Unknown business fields are preserved, but credential-shaped fields are rejected.
  function safeJSON(v,p,depth){
    if(depth>64)fail(p+'：嵌套过深');
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'){need(Number.isFinite(v),p,'有限数字');return;}
    if(Array.isArray(v)){v.forEach((x,i)=>safeJSON(x,p+'['+i+']',depth+1));return;}
    obj(v,p);
    for(const k of Object.keys(v)){
      if(['__proto__','constructor','prototype'].includes(k))fail(p+'：禁止原型字段');
      if(/^(api[_-]?key|access[_-]?token|refresh[_-]?token|github[_-]?token|token|cookie|cookies|password|authorization|secret)$/i.test(k))
        fail(p+'：发现敏感配置字段，停止业务备份');
      safeJSON(v[k],p+'.'+k,depth+1);
    }
  }
  function records(v,p,check){list(v,p);v.forEach((x,i)=>{obj(x,p+'['+i+']');check(x,p+'['+i+']');});}
  function map(v,p,check){obj(v,p);for(const k of Object.keys(v))check(v[k],p+'.'+k,k);}
  const validators={
    wb_marks(v,p){map(v,p,(x,q)=>fields(x,q,{fav:bool,category:text,reportDate:text,title:text,url:text,source:text,summary:text,impact:text,highlights:stringList}));},
    wb_weeks(v,p){map(v,p,(w,q,k)=>{date(k,q);map(w,q,(d,r,dk)=>{
      need(/^d[0-6]$/.test(dk),r,'d0至d6的日期字段');
      fields(d,r,{done:bool,subTasks:(a,s)=>records(a,s,(t,u)=>{text(t.id,u+'.id');text(t.text,u+'.text');bool(t.done,u+'.done');})});
    });});},
    wb_lab(v,p){obj(v,p);obj(v.weeks,p+'.weeks');map(v.weeks,p+'.weeks',(w,q,k)=>{
      date(k,q);fields(w,q,{title:text,steps:(a,s)=>records(a,s,(t,u)=>{
        text(t.name,u+'.name');bool(t.done,u+'.done');if(own(t,'hours'))number(t.hours,u+'.hours');
      }),ops:(o,s)=>map(o,s,(n,u)=>number(n,u))});
    });},
    wb_favgroups(v,p){records(v,p,(g,q)=>{
      text(g.id,q+'.id');text(g.name,q+'.name');fields(g,q,{note:text,category:text});
      records(g.items,q+'.items',(i,r)=>{text(i.id,r+'.id');fields(i,r,{url:text,summary:text,note:text,source:text,category:text,project:text});});
    });},
    wb_potions(v,p){records(v,p,(x,q)=>{text(x.id,q+'.id');text(x.title,q+'.title');fields(x,q,{content:text,cat:text,created:text});});},
    wb_hot_favs(v,p){records(v,p,(x,q)=>{text(x.id,q+'.id');text(x.title,q+'.title');fields(x,q,{reason:text,angle:text,example:text,source:text,cat:text,created:text});});},
    wb_potion_overrides(v,p){map(v,p,(x,q)=>text(x,q));},
    wb_rock_logs(v,p){map(v,p,(logs,q,k)=>{
      date(k.slice(0,10),q);records(logs,q,(l,r)=>fields(l,r,{time:text,body:text,ts:number}));
    });},
    wb_rock_plan:text,
    wb_rock_flows(v,p){map(v,p,(a,q,k)=>{date(k,q);records(a,q,(n,r)=>{text(n.title,r+'.title');text(n.content,r+'.content');});});},
    wb_hidden_quotes(v,p){map(v,p,(x,q)=>date(x,q));},
    wb_lab_checkin(v,p){
      obj(v,p);date(v.week,p+'.week');list(v.done,p+'.done');need(v.done.length===7,p+'.done','7个布尔值');
      v.done.forEach((x,i)=>bool(x,p+'.done['+i+']'));bool(v.hatched,p+'.hatched');
      need(Number.isInteger(v.spriteIdx)&&v.spriteIdx>=0,p+'.spriteIdx','非负整数');
      if(own(v,'lastCheck')&&v.lastCheck!==null)date(v.lastCheck,p+'.lastCheck');
    },
    wb_skip_log_modal:bool,
    wb_v2_state(v){need(V2&&typeof V2.validate==='function','V2数据','校验模块');V2.validate(v);}
  };
  function validateData(data){
    obj(data,'data');
    for(const key of Object.keys(data))if(!BUSINESS_KEYS.includes(key))fail('data：不接受未授权或敏感键');
    for(const key of BUSINESS_KEYS){
      need(own(data,key),'data.'+key,'完整备份字段（无数据用null）');
      if(data[key]!==null){safeJSON(data[key],key,0);validators[key](data[key],key);}
    }
    return data;
  }
  function validOrigin(origin){
    if(origin==='null')return true;
    try{const u=new URL(origin);return /^https?:$/.test(u.protocol)&&u.origin===origin&&u.username===''&&u.password==='';}catch(_){return false;}
  }
  function validateBackup(input){
    obj(input,'备份');need(input.schemaVersion===SCHEMA_VERSION,'schemaVersion','受支持的版本2');
    need(typeof input.exportedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(input.exportedAt)&&!isNaN(Date.parse(input.exportedAt)),'exportedAt','ISO时间');
    need(typeof input.sourceOrigin==='string'&&validOrigin(input.sourceOrigin),'sourceOrigin','不含密钥参数的origin');
    need(Object.keys(input).every(k=>['schemaVersion','exportedAt','sourceOrigin','data'].includes(k)),'备份','仅含约定元数据');
    validateData(input.data);return input;
  }
  function parseBackup(input){
    const value=typeof input==='string'?JSON.parse(input.replace(/^\uFEFF/,'')):input;
    validateBackup(value);return JSON.parse(JSON.stringify(value));
  }
  function rejectUnknownKeys(storage){
    for(let i=0;i<storage.length;i++){
      const k=storage.key(i);
      if(k&&k.startsWith('wb_')&&!BUSINESS_KEYS.includes(k)&&!SENSITIVE_KEYS.includes(k))
        fail('发现未登记的wb_数据键，停止导出／恢复，请先核对业务清单');
    }
  }
  function captureRaw(storage){
    rejectUnknownKeys(storage);const raw={};
    for(const k of BUSINESS_KEYS)raw[k]=storage.getItem(k);
    return raw;
  }
  function rawData(raw){
    const data={};for(const k of BUSINESS_KEYS){
      try{data[k]=raw[k]===null?null:JSON.parse(raw[k]);}
      catch(_){fail(k+'：现有数据不是合法JSON；没有跳过或删除该记录');}
    }
    return validateData(data);
  }
  function envelope(data,sourceOrigin){return validateBackup({schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),sourceOrigin,data});}
  function createBackup(storage,sourceOrigin){return envelope(rawData(captureRaw(storage)),sourceOrigin);}
  function canonical(v){
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
    return JSON.stringify(v);
  }
  function summarize(data){
    validateData(data);const rows={};
    for(const k of BUSINESS_KEYS){
      const v=data[k];let c={};
      if(v===null){rows[k]={present:false,counts:{}};continue;}
      if(k==='wb_marks')c={资讯:Object.keys(v).length,收藏:Object.values(v).filter(x=>x.fav).length,高亮:Object.values(v).reduce((a,x)=>a+(x.highlights||[]).length,0)};
      else if(k==='wb_weeks')c={周:Object.keys(v).length,完成天:Object.values(v).reduce((a,w)=>a+Object.values(w).filter(d=>d.done).length,0),子任务:Object.values(v).reduce((a,w)=>a+Object.values(w).reduce((b,d)=>b+(d.subTasks||[]).length,0),0)};
      else if(k==='wb_lab')c={周:Object.keys(v.weeks).length,步骤:Object.values(v.weeks).reduce((a,w)=>a+(w.steps||[]).length,0)};
      else if(k==='wb_favgroups')c={分组:v.length,条目:v.reduce((a,g)=>a+g.items.length,0)};
      else if(Array.isArray(v))c={条目:v.length};
      else if(k==='wb_rock_logs')c={日期:Object.keys(v).length,日志:Object.values(v).reduce((a,l)=>a+l.length,0)};
      else if(k==='wb_rock_flows')c={周:Object.keys(v).length,节点:Object.values(v).reduce((a,l)=>a+l.length,0)};
      else if(k==='wb_lab_checkin')c={周:v.week,天数:v.done.length,已打卡:v.done.filter(Boolean).length,已孵化:v.hatched};
      else if(k==='wb_v2_state')c=V2.counts(v);
      else if(typeof v==='string')c={字符:v.length};
      else if(typeof v==='boolean')c={已开启:v};
      else c={条目:Object.keys(v).length};
      rows[k]={present:true,counts:c};
    }
    return rows;
  }
  function freeze(v){if(object(v)||Array.isArray(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  function prepareRestore(input,storage){
    const backup=parseBackup(input),beforeRaw=captureRaw(storage);let current;
    try{current=summarize(rawData(beforeRaw));}catch(_){current={invalid:true};}
    return freeze({backup,beforeRaw,current,incoming:summarize(backup.data)});
  }
  let serial=0;
  function snapshotID(){return 'restore-'+Date.now()+'-'+(++serial)+'-'+Math.random().toString(36).slice(2,10);}
  function restoreRaw(storage,raw){
    // Free replacement data first, so quota is available for the original state.
    for(const k of BUSINESS_KEYS)storage.removeItem(k);
    for(const k of BUSINESS_KEYS)if(raw[k]!==null)storage.setItem(k,raw[k]);
    need(canonical(captureRaw(storage))===canonical(raw),'回滚','与恢复前逐键一致');
  }
  async function applyRestore(plan,options){
    need(options&&options.confirmed===true,'恢复','用户明确确认');
    const locks=options.locks;
    const needsLock=plan.backup?.data?.wb_v2_state!==null||options.storage.getItem('wb_v2_state')!==null;
    if(needsLock)need(locks&&typeof locks.request==='function','新数据恢复','安全写入锁');
    if(locks&&typeof locks.request==='function')return locks.request(V2.LOCK_NAME,()=>applyRestoreLocked(plan,options));
    return applyRestoreLocked(plan,options);
  }
  async function applyRestoreLocked(plan,options){
    need(options&&options.confirmed===true,'恢复','用户明确确认');
    const {storage,snapshots,sourceOrigin}=options;
    need(typeof sourceOrigin==='string'&&validOrigin(sourceOrigin),'恢复入口','有效origin');
    const backup=parseBackup(plan.backup);
    need(snapshots&&typeof snapshots.save==='function','快照','持久化快照存储');
    need(canonical(captureRaw(storage))===canonical(plan.beforeRaw),'当前数据','与预览时一致，请重新预览');
    const snapshot={snapshotVersion:1,id:snapshotID(),createdAt:new Date().toISOString(),sourceOrigin,
      status:'prepared',rawData:plan.beforeRaw,incomingSummary:summarize(backup.data)};
    // Failure here stops the restore before the first business-data write.
    await snapshots.save(snapshot);
    need(canonical(captureRaw(storage))===canonical(plan.beforeRaw),'当前数据','快照期间未发生变化，请重新预览');
    try{
      for(const k of BUSINESS_KEYS){
        if(backup.data[k]===null)storage.removeItem(k);
        else storage.setItem(k,JSON.stringify(backup.data[k]));
      }
      const actual=createBackup(storage,sourceOrigin);
      need(canonical(actual.data)===canonical(backup.data),'恢复核验','全部业务键及字段一致');
      await snapshots.save({...snapshot,status:'verified',verifiedAt:new Date().toISOString()});
      return {verified:true,snapshotId:snapshot.id,counts:summarize(actual.data),sourceOrigin:backup.sourceOrigin};
    }catch(error){
      let rolledBack=false;
      try{restoreRaw(storage,snapshot.rawData);rolledBack=true;}catch(_){}
      try{await snapshots.save({...snapshot,status:rolledBack?'rolled-back':'rollback-required'});}catch(_){}
      const failure=new Error(rolledBack?'恢复失败，已自动回滚到恢复前状态':'恢复失败，自动回滚未完成；原始快照已保留，请使用保全页回滚');
      failure.snapshotId=snapshot.id;failure.rolledBack=rolledBack;failure.cause=error;throw failure;
    }
  }
  function backupFromSnapshot(snapshot){
    need(snapshot&&snapshot.snapshotVersion===1,'快照','受支持的版本');
    obj(snapshot.rawData,'快照.rawData');
    need(Object.keys(snapshot.rawData).length===BUSINESS_KEYS.length,'快照','完整业务键');
    for(const k of BUSINESS_KEYS)need(own(snapshot.rawData,k)&&(snapshot.rawData[k]===null||typeof snapshot.rawData[k]==='string'),'快照.'+k,'原始字符串或null');
    return envelope(rawData(snapshot.rawData),snapshot.sourceOrigin);
  }
  function verifyBackup(input,storage,sourceOrigin){
    const expected=parseBackup(input),actual=createBackup(storage,sourceOrigin);
    return {equal:canonical(expected.data)===canonical(actual.data),counts:summarize(actual.data),expected:summarize(expected.data)};
  }
  return Object.freeze({SCHEMA_VERSION,BUSINESS_KEYS,SENSITIVE_KEYS,LABELS,validateBackup,parseBackup,
    createBackup,summarize,prepareRestore,applyRestore,backupFromSnapshot,verifyBackup,canonical});
});
