(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchSyncConfig=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const KEY='wb_sync_v2_cfg';
  function read(storage){
    const raw=storage.getItem(KEY);if(raw===null)return null;let c;try{c=JSON.parse(raw);}catch(_){throw new Error('V2同步配置损坏，请重新配置');}
    if(!c||c.schemaVersion!==1||typeof c.token!=='string'||!/^[a-f0-9]{5,64}$/i.test(c.gistId)||typeof c.deviceId!=='string'||typeof c.enabled!=='boolean'||typeof c.safeAutoUpload!=='boolean')throw new Error('V2同步配置不受支持，请重新配置');return c;
  }
  function save(storage,input){
    let old=null;try{old=read(storage);}catch(_){} // Explicit configuration can repair malformed config.
    const gistId=String(input.gistId||'').trim(),token=String(input.token||old?.token||'').trim();
    if(!/^[a-f0-9]{5,64}$/i.test(gistId)||!token)throw new Error('请填写Gist ID和Token');
    const same=old?.gistId===gistId,c={schemaVersion:1,gistId,token,deviceId:old?.deviceId||globalThis.crypto.randomUUID(),enabled:input.enabled===true,safeAutoUpload:input.safeAutoUpload===true,lastSuccessAt:same?old.lastSuccessAt:null,knownSyncVersion:same?old.knownSyncVersion:null,knownVersionId:same?old.knownVersionId:null};
    storage.setItem(KEY,JSON.stringify(c));return c;
  }
  function acknowledged(storage,c,env,at){
    const latest=read(storage);if(!latest||latest.gistId!==c.gistId||latest.deviceId!==c.deviceId||latest.token!==c.token)throw new Error('同步配置在操作中变化，未记录成功状态');
    storage.setItem(KEY,JSON.stringify({...latest,lastSuccessAt:at,knownSyncVersion:env.syncVersion,knownVersionId:env.versionId}));
  }
  function legacy(storage,confirmed){
    if(confirmed!==true)throw new Error('读取旧配置需要确认');let c;try{c=JSON.parse(storage.getItem('wb_sync_cfg')||'null');}catch(_){throw new Error('旧同步配置无法读取');}
    if(!c||typeof c.token!=='string'||typeof c.gistId!=='string')throw new Error('没有可复用的旧Gist配置');return {gistId:c.gistId,token:c.token};
  }
  function publicInfo(c){return c?{gistId:c.gistId,deviceId:c.deviceId,enabled:c.enabled,safeAutoUpload:c.safeAutoUpload,lastSuccessAt:c.lastSuccessAt,knownSyncVersion:c.knownSyncVersion,knownVersionId:c.knownVersionId,hasToken:!!c.token}:null;}
  return Object.freeze({KEY,read,save,acknowledged,legacy,publicInfo});
});
