(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./backup-core.js'),require('./v2-data-core.js'));
  else root.WorkbenchSyncModel=factory(root.WorkbenchBackup,root.WorkbenchDataV2);
})(typeof self!=='undefined'?self:this,function(Backup,V2){
  'use strict';
  const SCHEMA_VERSION=1,FILENAME='workbench-v2-sync.json',clone=x=>JSON.parse(JSON.stringify(x)),equal=(a,b)=>Backup.canonical(a)===Backup.canonical(b);
  const uuid=/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,99}$/,hashPattern=/^[a-f0-9]{64}$/;
  function need(ok,message){if(!ok)throw new Error(message);}
  function validateState(state){Backup.parseBackup({schemaVersion:2,exportedAt:'2026-01-01T00:00:00.000Z',sourceOrigin:'null',data:state});return state;}
  async function hash(value){const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(Backup.canonical(value)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
  async function envelope(state,{syncVersion,versionId=globalThis.crypto.randomUUID(),parents=[],sourceDeviceId,sourceOrigin,updatedAt=new Date().toISOString()}){
    const e={schemaVersion:SCHEMA_VERSION,syncVersion,versionId,parents:[...parents],updatedAt,sourceDeviceId,sourceOrigin,stateHash:await hash(state),state:clone(state)};return parse(e);
  }
  async function parse(input){
    let e;try{e=typeof input==='string'?JSON.parse(input.replace(/^\uFEFF/,'')):clone(input);}catch(_){throw new Error('云端文件不是有效JSON');}
    need(e&&typeof e==='object'&&!Array.isArray(e),'云端JSON结构损坏');
    need(e.schemaVersion===SCHEMA_VERSION,'不支持此云端schemaVersion');
    need(Object.keys(e).length===9&&Object.keys(e).every(k=>['schemaVersion','syncVersion','versionId','parents','updatedAt','sourceDeviceId','sourceOrigin','stateHash','state'].includes(k)),'云端JSON字段不符合V2同步格式');
    need(Number.isSafeInteger(e.syncVersion)&&e.syncVersion>=1,'云端syncVersion不合法');
    need(typeof e.versionId==='string'&&uuid.test(e.versionId)&&typeof e.sourceDeviceId==='string'&&uuid.test(e.sourceDeviceId),'云端设备或版本标识不合法');
    need(Array.isArray(e.parents)&&e.parents.length<=64&&e.parents.every(p=>typeof p==='string'&&uuid.test(p)&&p!==e.versionId)&&new Set(e.parents).size===e.parents.length,'云端父版本标识不合法');
    Backup.parseBackup({schemaVersion:2,exportedAt:e.updatedAt,sourceOrigin:e.sourceOrigin,data:e.state});
    need(typeof e.stateHash==='string'&&hashPattern.test(e.stateHash)&&await hash(e.state)===e.stateHash,'云端内容hash核验失败');return e;
  }
  function status(local,remote,base){
    validateState(local);if(!remote)return {status:'empty',localChanged:true,remoteChanged:false,hasBase:!!base};
    const same=equal(local,remote.state),hasBase=!!base;
    if(same)return {status:hasBase?'synced':'first-existing',localChanged:!hasBase,remoteChanged:!hasBase,hasBase};
    if(!hasBase)return {status:'first-existing',localChanged:true,remoteChanged:true,hasBase:false};
    const localChanged=!equal(local,base.state),remoteChanged=remote.versionId!==base.versionId||remote.stateHash!==base.stateHash;
    return {status:localChanged&&remoteChanged?'conflict':localChanged?'local':remoteChanged?'remote':'failure',localChanged,remoteChanged,hasBase:true};
  }
  function diff(base,local,remote){
    validateState(local);validateState(remote);if(base)validateState(base);
    const entries=[];
    function entry(key,collection,id,b,l,r){
      const lc=!equal(l,b),rc=!equal(r,b),record=!!collection;
      const describe=(side,v,old)=>v===null?(record?'无法安全判断':side+'删除'):record&&v.deletedAt?side+'删除':old===null?side+'新增':side+'更新';
      let choice,conflict=false,reason='';
      if(equal(l,r))choice='local';
      else if(record&&((b!==null&&(l===null||r===null))||(b?.deletedAt&&((l&&!l.deletedAt)||(r&&!r.deletedAt))))){conflict=true;reason='记录缺失或删除后恢复，无法安全判断';}
      else if(!lc)choice='remote';else if(!rc)choice='local';else{conflict=true;reason=record?'双方修改同一条记录':'双方修改同一业务项，不能安全合并内部结构';}
      if(equal(l,r)&&equal(l,b))return;
      entries.push({key,collection,id,base:clone(b),local:clone(l),remote:clone(r),localChange:lc?describe('本地',l,b):null,remoteChange:rc?describe('云端',r,b):null,conflict,reason,choice:choice||null});
    }
    for(const key of Backup.BUSINESS_KEYS){
      if(key!=='wb_v2_state'){entry(key,null,null,base?base[key]:null,local[key],remote[key]);continue;}
      for(const collection of V2.COLLECTIONS){
        const b=new Map((base?.[key]?.collections[collection]||[]).map(r=>[r.id,r])),l=new Map((local[key]?.collections[collection]||[]).map(r=>[r.id,r])),r=new Map((remote[key]?.collections[collection]||[]).map(r=>[r.id,r]));
        for(const id of new Set([...b.keys(),...l.keys(),...r.keys()]))entry(key,collection,id,b.get(id)||null,l.get(id)||null,r.get(id)||null);
      }
    }
    const counts={localAdded:0,remoteAdded:0,localUpdated:0,remoteUpdated:0,localDeleted:0,remoteDeleted:0,safe:0,conflicts:0,uncertain:0};
    for(const e of entries){for(const [side,prefix] of [['local','本地'],['remote','云端']]){if(e[side+'Change']===prefix+'新增')counts[side+'Added']++;if(e[side+'Change']===prefix+'更新')counts[side+'Updated']++;if(e[side+'Change']===prefix+'删除')counts[side+'Deleted']++;}if(e.conflict){counts.conflicts++;if(e.reason.includes('无法'))counts.uncertain++;}else counts.safe++;}
    return {hasBase:!!base,entries,counts,base:base?clone(base):null,local:clone(local),remote:clone(remote)};
  }
  function resolve(plan,choices={},at=new Date().toISOString()){
    const result=clone(plan.local),rows={};for(const collection of V2.COLLECTIONS)rows[collection]=new Map((result.wb_v2_state?.collections[collection]||[]).map(r=>[r.id,r]));
    let v2Changed=false;
    for(const [index,e] of plan.entries.entries()){
      const side=e.conflict?choices[index]:e.choice;need(side==='local'||side==='remote','还有冲突未明确选择本地或云端');let value=clone(e[side]);
      if(!e.collection){result[e.key]=value;continue;}
      if(e.conflict){
        const records=[e.base,e.local,e.remote].filter(Boolean),revision=Math.max(...records.map(r=>r.revision))+1;
        // Choosing an absent record means an explicit deletion, represented by a tombstone.
        value=value?{...value,revision,updatedAt:at}:{...clone(e.local||e.remote||e.base),revision,updatedAt:at,deletedAt:at};
      }
      if(value)rows[e.collection].set(e.id,value);else rows[e.collection].delete(e.id);
      if(!equal(value,e.local))v2Changed=true;
    }
    if(v2Changed){const local=plan.local.wb_v2_state,remote=plan.remote.wb_v2_state;result.wb_v2_state={schemaVersion:1,revision:Math.max(local?.revision||0,remote?.revision||0)+1,updatedAt:at,collections:Object.fromEntries(V2.COLLECTIONS.map(c=>[c,[...rows[c].values()]]))};}
    else if(plan.remote.wb_v2_state&&(!result.wb_v2_state||plan.remote.wb_v2_state.revision>result.wb_v2_state.revision)){
      // Preserve the global revision watermark without using it to pick a record winner.
      result.wb_v2_state={...(result.wb_v2_state||clone(plan.remote.wb_v2_state)),revision:plan.remote.wb_v2_state.revision,updatedAt:plan.remote.wb_v2_state.updatedAt};
    }
    validateState(result);return result;
  }
  function directions(state){validateState(state);return (state.wb_v2_state?.collections.topics||[]).filter(r=>r.deletedAt===null&&r.data.kind==='direction'&&r.data.enabled===true).sort((a,b)=>a.data.order-b.data.order||a.id.localeCompare(b.id)).map(r=>({id:r.id,revision:r.revision,name:r.data.title,find:r.data.find,exclude:r.data.exclude,accountStage:r.data.accountStage,contentPreferences:r.data.contentPreferences??'',order:r.data.order}));}
  return Object.freeze({SCHEMA_VERSION,FILENAME,hash,envelope,parse,validateState,equal,status,diff,resolve,directions});
});
