/* P0 safety lock: keep wb_sync_cfg; never read credentials or contact Gist. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SyncCore=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const paused=()=>Promise.resolve({ok:false,reason:'p0-paused',status:'待修复'});
  function createSync(){return Object.freeze({status:'待修复',markDirty(){},schedulePush(){},push:paused,pull:paused,mergePull:paused,ensureGist:paused,collect:()=>({})});}
  return Object.freeze({PAUSED:true,SYNC_KEYS:Object.freeze([]),GIST_FILENAME:'workbench-sync.json',createSync});
});
