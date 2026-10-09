(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./radar-adapter.js'));
  else root.WorkbenchRadarModel=factory(root.WorkbenchRadarAdapter);
})(typeof self!=='undefined'?self:this,function(Adapter){
  'use strict';
  const VERSION=1,STATUSES=Object.freeze({candidate:'旧候选',selected:'选题',considering:'待选',adopted:'已做成视频',abandoned:'PASS'});
  const clone=x=>JSON.parse(JSON.stringify(x)),own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  function need(ok,message){if(!ok)throw new Error(message);}
  function validate(data){
    need(data.radarSchemaVersion===VERSION,'选题数据版本不受支持');
    need(typeof data.title==='string'&&data.title.trim().length>0,'方向／选题名称不能为空');
    if(data.kind==='direction'){
      for(const k of ['find','exclude','accountStage'])need(typeof data[k]==='string','方向字段 '+k+' 应为文本');
      if(own(data,'contentPreferences'))need(typeof data.contentPreferences==='string','方向内容偏好应为文本');
      need(typeof data.enabled==='boolean'&&Number.isSafeInteger(data.order),'方向启用状态或排序不合法');
    }else{
      need(data.kind==='candidate','选题记录类型不受支持');
      for(const k of ['dedupeKey','originalCategory','reason','angle','example','sourceText','origin','abandonReason','adoptNote','sourceDate'])need(typeof data[k]==='string','候选字段 '+k+' 应为文本');
      need(data.dedupeKey.length>0&&own(STATUSES,data.status),'候选标识或状态不合法');
      for(const k of ['eventBrief','riskNote','eventId'])if(own(data,k))need(typeof data[k]==='string','候选字段 '+k+' 应为文本');
      if(own(data,'madeVideoAt'))need(typeof data.madeVideoAt==='string'&&(data.madeVideoAt===''||!Number.isNaN(Date.parse(data.madeVideoAt))),'制作时间不合法');
      if(own(data,'eventId'))need(data.eventId.trim().length>0&&data.dedupeKey==='event:'+data.eventId,'事件标识与去重键不一致');
      need(data.directionId===null||(typeof data.directionId==='string'&&data.directionId.length>0),'候选方向ID不合法');
      need(Array.isArray(data.sources),'来源应为列表');
      for(const source of data.sources)need(source&&typeof source.label==='string'&&(source.url===null||(typeof source.url==='string'&&Adapter.safeUrl(source.url)===source.url)),'来源链接不合法');
      if(own(data,'legacyRecords'))need(Array.isArray(data.legacyRecords),'旧记录应为数组');
    }
    return data;
  }
  function normalizeCandidate(record){
    const d=record.data;if(own(d,'radarSchemaVersion')){validate(d);return clone(d);}
    // Preserve early P0 topic fields while making them visible in candidates.
    return {...clone(d),...Adapter.candidate(d,'v2-previous')};
  }
  const compare=(a,b)=>a.data.order-b.data.order||(a.id<b.id?-1:a.id>b.id?1:0);
  async function candidateId(key){
    const bytes=new TextEncoder().encode(key),hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    return 'radar-candidate-'+Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
  }
  function createService(store){
    function snapshot(){
      const state=store.load(),rows=state.collections.topics;
      const directions=rows.filter(r=>r.data.kind==='direction').map(clone).sort(compare);
      const candidates=rows.filter(r=>r.data.kind!=='direction').map(r=>({...r,data:normalizeCandidate(r)}));
      candidates.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||(a.id<b.id?-1:1));
      return {revision:state.revision,directions,candidates};
    }
    function put(record,data){validate(data);return store.put('topics',data,record?{recordId:record.id,expectedRevision:record.revision}:{});}
    function directionData(fields,old){
      const data=old?{contentPreferences:'',...clone(old)}:{radarSchemaVersion:VERSION,kind:'direction',title:'',find:'',exclude:'',accountStage:'',contentPreferences:'',enabled:true,order:0};
      for(const key of ['title','find','exclude','accountStage','contentPreferences','enabled'])if(own(fields,key))data[key]=fields[key];
      data.title=data.title.trim();return data;
    }
    async function insert(candidates){
      const entries=await Promise.all(candidates.map(async data=>({id:await candidateId(data.dedupeKey),data:validate(data)})));
      return store.insertRadarCandidates(entries);
    }
    return Object.freeze({snapshot,
      createDirection(fields){const live=snapshot().directions.filter(r=>r.deletedAt===null),data=directionData(fields);data.order=live.length?Math.max(...live.map(r=>r.data.order))+1:0;return put(null,data);},
      editDirection(record,fields){need(record.data.kind==='direction'&&record.deletedAt===null,'方向已删除');return put(record,directionData(fields,record.data));},
      toggleDirection(record){return this.editDirection(record,{enabled:!record.data.enabled});},
      removeDirection(record,confirmed){need(confirmed===true,'删除方向需要再次确认');need(record.data.kind==='direction','记录不是选题方向');return store.remove('topics',record.id,record.revision);},
      moveDirection(current,id,delta){
        need(delta===-1||delta===1,'排序方向不合法');const rows=current.directions.filter(r=>r.deletedAt===null),i=rows.findIndex(r=>r.id===id),j=i+delta;
        need(i>=0&&j>=0&&j<rows.length,'方向已在边界或列表已变化');const ids=rows.map(r=>r.id);[ids[i],ids[j]]=[ids[j],ids[i]];return store.reorderDirections(ids,current.revision);
      },
      enabledDirections(){const s=snapshot();return {schemaVersion:VERSION,stateRevision:s.revision,directions:s.directions.filter(r=>r.deletedAt===null&&r.data.enabled).map(r=>({id:r.id,revision:r.revision,name:r.data.title,find:r.data.find,exclude:r.data.exclude,accountStage:r.data.accountStage,contentPreferences:r.data.contentPreferences??'',order:r.data.order}))};},
      saveCandidate(data){return insert([clone(data)]);},
      async classifyGenerated(draft,status){
        need(['selected','considering','abandoned'].includes(status),'归类状态不合法');
        const data=Adapter.generated(draft);data.status=status;validate(data);
        const result=await insert([data]),record=result.records[0];
        need(record&&record.data.eventId===data.eventId,'事件标识发生冲突');
        need(record.deletedAt===null,'此事件已删除，不会自动恢复');
        if(result.added)return record;
        if(record.data.status===status)return record;
        return this.updateCandidate(record,{status});
      },
      importLegacy(raw){return insert(Adapter.legacyFavorites(raw));},
      updateCandidate(record,fields){
        need(record.data.kind!=='direction'&&record.deletedAt===null,'候选已删除');const data=normalizeCandidate(record);
        for(const key of ['status','abandonReason','adoptNote','directionId'])if(own(fields,key))data[key]=fields[key];
        if(own(fields,'status')&&fields.status!=='adopted'&&own(data,'madeVideoAt'))data.madeVideoAt='';
        if(own(fields,'directionId')&&data.directionId!==null&&data.directionId!==record.data.directionId)need(snapshot().directions.some(r=>r.id===data.directionId),'所选方向不存在');
        return put(record,data);
      },
      markMadeVideo(record){
        need(record.data.kind!=='direction'&&record.deletedAt===null,'候选已删除');
        const data=normalizeCandidate(record);data.status='adopted';data.madeVideoAt=new Date().toISOString();
        return put(record,data);
      }
    });
  }
  return Object.freeze({VERSION,STATUSES,validate,normalizeCandidate,candidateId,createService});
});
