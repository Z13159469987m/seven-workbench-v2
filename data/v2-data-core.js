/* V2 data foundation only: no UI, migration, initialization writes, or network. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./projects-model.js'),require('./radar-model.js'),require('./favorites-model.js'));
  else root.WorkbenchDataV2=factory(root.WorkbenchProjectsModel,root.WorkbenchRadarModel,root.WorkbenchFavoritesModel);
})(typeof self!=='undefined'?self:this,function(Projects,Radar,Favorites){
  'use strict';
  const STORAGE_KEY='wb_v2_state',LOCK_NAME='workbench-v2-business',SCHEMA_VERSION=1;
  const COLLECTIONS=Object.freeze(['projects','topics','favoriteGroups','favorites']);
  const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
  const clone=x=>JSON.parse(JSON.stringify(x));
  function need(ok,message){if(!ok)throw new Error(message);}
  function iso(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&!isNaN(Date.parse(v));}
  function safe(v,depth=0){
    need(depth<64,'V2数据嵌套过深');
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'){need(Number.isFinite(v),'V2数字不合法');return;}
    if(Array.isArray(v)){v.forEach(x=>safe(x,depth+1));return;}
    need(obj(v),'V2字段必须是JSON数据');
    for(const k of Object.keys(v)){
      need(!['__proto__','prototype','constructor'].includes(k),'V2数据禁止原型字段');
      need(!/^(api[_-]?key|access[_-]?token|refresh[_-]?token|github[_-]?token|token|cookie|cookies|password|authorization|secret)$/i.test(k),'V2业务数据不接受敏感配置字段');
      safe(v[k],depth+1);
    }
  }
  function validatePayload(collection,data){
    need(obj(data),'V2记录data应为对象');safe(data);
    const titleField=['projects','favoriteGroups'].includes(collection)?'name':'title';
    const optionalTitle=collection==='favorites'&&Object.prototype.hasOwnProperty.call(data,'favoriteSchemaVersion');
    need(typeof data[titleField]==='string'&&(optionalTitle||data[titleField].trim().length>0),'V2记录缺少名称／标题');
    if(collection==='favorites')need(typeof data.url==='string','V2收藏缺少链接字符串');
    if(collection==='projects'&&Object.prototype.hasOwnProperty.call(data,'projectSchemaVersion')){
      need(Projects&&typeof Projects.validate==='function','项目校验模块未加载');Projects.validate(data);
    }
    if(collection==='topics'&&Object.prototype.hasOwnProperty.call(data,'radarSchemaVersion')){
      need(Radar&&typeof Radar.validate==='function','选题校验模块未加载');Radar.validate(data);
    }
    if(['favorites','favoriteGroups'].includes(collection)&&Object.prototype.hasOwnProperty.call(data,'favoriteSchemaVersion')){
      need(Favorites&&typeof Favorites.validate==='function','收藏校验模块未加载');Favorites.validate(collection,data);
    }
  }
  function validate(state){
    need(obj(state)&&state.schemaVersion===SCHEMA_VERSION,'V2数据版本不受支持');safe(state);
    need(Number.isSafeInteger(state.revision)&&state.revision>=0,'V2状态revision应为非负安全整数');
    need(iso(state.updatedAt),'V2状态updatedAt应为ISO时间');
    need(obj(state.collections)&&Object.keys(state.collections).length===COLLECTIONS.length,'V2数据集合不完整');
    for(const c of COLLECTIONS){
      need(Array.isArray(state.collections[c]),'V2缺少集合 '+c);const ids=new Set();
      for(const r of state.collections[c]){
        need(obj(r)&&typeof r.id==='string'&&r.id.length>0&&!ids.has(r.id),'V2记录ID缺失或重复');ids.add(r.id);
        need(Number.isSafeInteger(r.revision)&&r.revision>=1,'V2记录revision应为正安全整数');
        need(iso(r.createdAt)&&iso(r.updatedAt)&&(r.deletedAt===null||iso(r.deletedAt)),'V2记录时间不合法');
        validatePayload(c,r.data);
      }
    }
    return state;
  }
  function createState(now=new Date().toISOString()){
    return validate({schemaVersion:SCHEMA_VERSION,revision:0,updatedAt:now,
      collections:Object.fromEntries(COLLECTIONS.map(c=>[c,[]]))});
  }
  function counts(state){validate(state);return Object.fromEntries(COLLECTIONS.map(c=>[c,{
    active:state.collections[c].filter(r=>r.deletedAt===null).length,
    deleted:state.collections[c].filter(r=>r.deletedAt!==null).length
  }]));}
  function createStore(storage,options={}){
    const now=options.now||(()=>new Date().toISOString());
    const id=options.id||(()=>{
      need(typeof globalThis.crypto?.randomUUID==='function','当前环境无法生成可靠ID');return crypto.randomUUID();
    });
    const locks=Object.prototype.hasOwnProperty.call(options,'locks')?options.locks:(typeof navigator!=='undefined'?navigator.locks:null);
    function load(){const raw=storage.getItem(STORAGE_KEY);return raw===null?createState(now()):clone(validate(JSON.parse(raw)));}
    async function write(collection,recordId,data,expectedRevision,deleted){
      need(COLLECTIONS.includes(collection),'未知V2业务集合');
      if(recordId!==undefined)need(typeof recordId==='string'&&recordId.length>0,'V2记录ID应为非空字符串');
      if(!deleted)validatePayload(collection,data);
      const payload=deleted?null:clone(data);
      need(locks&&typeof locks.request==='function','缺少安全写入锁：请使用支持Web Locks的HTTPS或本地开发入口');
      return locks.request(LOCK_NAME,async()=>{
        const state=load(),rows=state.collections[collection],existing=rows.find(r=>r.id===recordId);
        if(existing)need(expectedRevision===existing.revision,'V2记录已变化，请重新读取；未覆盖旧数据');
        else need(expectedRevision===undefined||expectedRevision===0,'V2记录不存在，未覆盖旧数据');
        if(deleted)need(existing,'V2记录不存在，无法标记删除');
        const at=now(),record=existing?{...existing,revision:existing.revision+1,updatedAt:at,deletedAt:deleted?at:null,data:deleted?existing.data:payload}:
          {id:recordId||id(),revision:1,createdAt:at,updatedAt:at,deletedAt:null,data:payload};
        validatePayload(collection,record.data);
        if(existing)rows[rows.indexOf(existing)]=record;else rows.push(record);
        const next={...state,revision:state.revision+1,updatedAt:at};validate(next);
        // One serialized localStorage value avoids partial multi-collection commits.
        storage.setItem(STORAGE_KEY,JSON.stringify(next));return clone(record);
      });
    }
    async function reorderProjects(recordIds,expectedStateRevision){
      need(Array.isArray(recordIds),'项目排序应为ID列表');const ids=[...recordIds];
      need(locks&&typeof locks.request==='function','缺少安全写入锁');
      return locks.request(LOCK_NAME,async()=>{
        const state=load(),rows=state.collections.projects,live=rows.filter(r=>r.deletedAt===null);
        need(state.revision===expectedStateRevision,'项目列表已变化，请刷新后重试；未覆盖旧数据');
        need(ids.length===live.length&&new Set(ids).size===ids.length&&ids.every(id=>live.some(r=>r.id===id)),'项目排序列表不完整');
        const at=now();let changed=false;
        state.collections.projects=rows.map(r=>{
          const order=ids.indexOf(r.id);if(r.deletedAt!==null||r.data.order===order)return r;
          changed=true;return {...r,revision:r.revision+1,updatedAt:at,data:{...r.data,order}};
        });
        if(changed){state.revision++;state.updatedAt=at;validate(state);storage.setItem(STORAGE_KEY,JSON.stringify(state));}
        return clone(state);
      });
    }
    async function insertRadarCandidates(input){
      need(Array.isArray(input),'候选导入应为数组');
      const entries=input.map(entry=>{
        need(entry&&typeof entry.id==='string'&&entry.id.length>0,'候选ID不合法');
        validatePayload('topics',entry.data);need(entry.data.kind==='candidate','只能导入候选');return clone(entry);
      });
      if(!entries.length)return {added:0,duplicates:0,records:[]};
      need(locks&&typeof locks.request==='function','缺少安全写入锁');
      return locks.request(LOCK_NAME,async()=>{
        const state=load(),rows=state.collections.topics,records=[];let added=0;
        const byKey=new Map(rows.filter(r=>r.data.kind!=='direction').map(r=>[Radar.normalizeCandidate(r).dedupeKey,r]));
        const at=now();
        for(const entry of entries){
          // Including tombstones prevents a legacy import from resurrecting deletions.
          if(byKey.has(entry.data.dedupeKey)){records.push(byKey.get(entry.data.dedupeKey));continue;}
          const record={id:entry.id,revision:1,createdAt:at,updatedAt:at,deletedAt:null,data:entry.data};
          rows.push(record);byKey.set(entry.data.dedupeKey,record);records.push(record);added++;
        }
        if(added){state.revision++;state.updatedAt=at;validate(state);storage.setItem(STORAGE_KEY,JSON.stringify(state));}
        return {added,duplicates:entries.length-added,records:clone(records)};
      });
    }
    async function reorderDirections(recordIds,expectedStateRevision){
      need(Array.isArray(recordIds),'方向排序应为ID列表');const ids=[...recordIds];
      need(locks&&typeof locks.request==='function','缺少安全写入锁');
      return locks.request(LOCK_NAME,async()=>{
        const state=load(),live=state.collections.topics.filter(r=>r.data.kind==='direction'&&r.deletedAt===null);
        need(state.revision===expectedStateRevision,'方向列表已变化，请重新读取；未覆盖旧数据');
        need(ids.length===live.length&&new Set(ids).size===ids.length&&ids.every(id=>live.some(r=>r.id===id)),'方向排序列表不完整');
        const at=now();let changed=false;
        state.collections.topics=state.collections.topics.map(r=>{
          if(r.data.kind!=='direction'||r.deletedAt!==null)return r;const order=ids.indexOf(r.id);if(r.data.order===order)return r;
          changed=true;return {...r,revision:r.revision+1,updatedAt:at,data:{...r.data,order}};
        });
        if(changed){state.revision++;state.updatedAt=at;validate(state);storage.setItem(STORAGE_KEY,JSON.stringify(state));}
        return clone(state);
      });
    }
    // Favorites-only transactions share the P0 lock and commit both collections once.
    async function favoriteTransaction(run){
      need(locks&&typeof locks.request==='function','缺少安全写入锁：请使用HTTPS或localhost入口');
      return locks.request(LOCK_NAME,async()=>{
        const state=load(),at=now(),result=run(state,at);
        if(result.changed){state.revision++;state.updatedAt=at;validate(state);storage.setItem(STORAGE_KEY,JSON.stringify(state));}
        return clone(result.value);
      });
    }
    function saveFavorite(data,recordId,expectedRevision){
      validatePayload('favorites',data);const payload=clone(data);
      return favoriteTransaction((state,at)=>{
        const rows=state.collections.favorites,old=rows.find(r=>r.id===recordId);
        if(recordId!==undefined)need(old&&old.deletedAt===null&&old.revision===expectedRevision,'收藏已变化，请重新读取；未覆盖旧数据');
        if(payload.groupId!==null){const group=state.collections.favoriteGroups.find(r=>r.id===payload.groupId);need(group&&!group.deletedAt,'收藏夹已删除或不存在，请重新选择');}
        if(payload.projectId!==null)need(state.collections.projects.some(r=>r.id===payload.projectId)||old?.data.projectId===payload.projectId,'关联项目不存在');
        const record=old?{...old,revision:old.revision+1,updatedAt:at,data:payload}:{id:id(),revision:1,createdAt:at,updatedAt:at,deletedAt:null,data:payload};
        if(old)rows[rows.indexOf(old)]=record;else rows.push(record);return {changed:true,value:record};
      });
    }
    function removeFavoriteGroup(recordId,expectedRevision){
      return favoriteTransaction((state,at)=>{
        const r=state.collections.favoriteGroups.find(r=>r.id===recordId);need(r&&!r.deletedAt&&r.revision===expectedRevision,'收藏夹已变化，请重新读取；未覆盖旧数据');
        r.deletedAt=at;r.updatedAt=at;r.revision++;
        for(const f of state.collections.favorites)if(!f.deletedAt&&f.data.groupId===recordId){f.data={...Favorites.favoriteData(f.data),groupId:null,inbox:true};f.revision++;f.updatedAt=at;}
        return {changed:true,value:r};
      });
    }
    function reorderFavoriteGroups(recordIds,expectedRevision){
      need(Array.isArray(recordIds),'收藏夹排序应为列表');const ids=[...recordIds];
      return favoriteTransaction((state,at)=>{
        need(state.revision===expectedRevision,'收藏夹列表已变化，请重新读取');const rows=state.collections.favoriteGroups.filter(r=>!r.deletedAt);
        need(ids.length===rows.length&&new Set(ids).size===ids.length&&ids.every(id=>rows.some(r=>r.id===id)),'收藏夹排序不完整');let changed=false;
        for(const r of rows){const order=ids.indexOf(r.id);if(order!==r.data.order){r.data={...Favorites.groupData(r.data),order};r.updatedAt=at;r.revision++;changed=true;}}
        return {changed,value:state};
      });
    }
    function importFavoriteLegacy(input){
      need(input&&Array.isArray(input.groups)&&Array.isArray(input.favorites),'旧收藏导入结构不合法');const payload=clone(input);
      for(const [collection,entries] of [['favoriteGroups',payload.groups],['favorites',payload.favorites]])for(const entry of entries){need(typeof entry.id==='string'&&entry.id.length>0,'旧收藏ID缺失');validatePayload(collection,entry.data);}
      if(!payload.groups.length&&!payload.favorites.length)return Promise.resolve({groups:0,favorites:0});
      return favoriteTransaction((state,at)=>{
        const added={groups:0,favorites:0};
        for(const [collection,key] of [['favoriteGroups','groups'],['favorites','favorites']])for(const entry of payload[key]){
          const rows=state.collections[collection];if(rows.some(r=>r.id===entry.id))continue; // Tombstones also count as imported.
          if(collection==='favorites'&&!state.collections.favoriteGroups.some(r=>r.id===entry.data.groupId&&!r.deletedAt))entry.data={...entry.data,groupId:null,inbox:true};
          rows.push({id:entry.id,revision:1,createdAt:at,updatedAt:at,deletedAt:null,data:entry.data});added[key]++;
        }
        return {changed:added.groups+added.favorites>0,value:added};
      });
    }
    return Object.freeze({load,reorderProjects,insertRadarCandidates,reorderDirections,saveFavorite,removeFavoriteGroup,reorderFavoriteGroups,importFavoriteLegacy,
      list(collection,{includeDeleted=false}={}){need(COLLECTIONS.includes(collection),'未知V2业务集合');return load().collections[collection].filter(r=>includeDeleted||r.deletedAt===null);},
      put(collection,data,{recordId,expectedRevision}={}){return write(collection,recordId,data,expectedRevision,false);},
      remove(collection,recordId,expectedRevision){return write(collection,recordId,null,expectedRevision,true);}
    });
  }
  return Object.freeze({STORAGE_KEY,LOCK_NAME,SCHEMA_VERSION,COLLECTIONS,createState,validate,counts,createStore});
});
