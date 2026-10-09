/* Pure compatibility boundary: no DOM, storage, network or fixed directions. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.WorkbenchRadarAdapter=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const text=v=>typeof v==='string'?v:'';
  function safeUrl(value){
    try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch(_){return null;}
  }
  function identity(title){return 'title:'+title.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
  function sources(value){
    if(Array.isArray(value))return value.flatMap(item=>{
      if(typeof item==='string')return sources(item);
      if(!item||typeof item!=='object')return [];
      const url=safeUrl(text(item.url));return [{sourceId:text(item.sourceId),label:text(item.label)||text(item.title)||url||'来源未注明',url}];
    });
    if(!text(value).trim())return [];
    return value.split(/\s+\+\s+|\n|；/).filter(x=>x.trim()).flatMap(part=>{
      const label=part.trim();
      const explicit=label.match(/https?:\/\/[^\s<>"'，；（）()]+/gi)||[];
      // Do not parse a domain fragment inside an already explicit URL (e.g. .company as .com).
      const remainder=label.replace(/https?:\/\/[^\s<>"'，；（）()]+/gi,' ');
      const bare=remainder.match(/\b(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|ai|co|work)(?![a-z0-9.-])(?::\d+)?(?:\/[^\s<>"'，；（）()]*)?/gi)||[];
      const urls=[...new Set([...explicit,...bare.map(u=>'https://'+u)].map(u=>safeUrl(u.replace(/[.,;。]+$/,''))).filter(Boolean))];
      return urls.length?urls.map(url=>({label,url})):[{label,url:null}];
    });
  }
  function candidate(row,origin='hot_topics'){
    if(!row||typeof row.title!=='string'||!row.title.trim())throw new Error('选题缺少标题');
    return {radarSchemaVersion:1,kind:'candidate',title:row.title.trim(),dedupeKey:identity(row.title),
      directionId:null,originalCategory:text(row.category)||text(row.cat),reason:text(row.reason),angle:text(row.angle),example:text(row.example),
      sources:sources(row.sources??row.source),sourceText:text(row.source),origin,status:'candidate',abandonReason:'',adoptNote:'',
      sourceDate:text(row.created)||text(row.date)};
  }
  function generated(draft){
    if(!draft||typeof draft.eventId!=='string'||!draft.eventId.trim()||typeof draft.title!=='string'||!draft.title.trim())throw new Error('生成选题缺少事件标识或标题');
    if(typeof draft.directionId!=='string'||!draft.directionId.trim())throw new Error('生成选题缺少方向ID');
    return {radarSchemaVersion:1,kind:'candidate',title:draft.title.trim(),dedupeKey:'event:'+draft.eventId.trim(),
      eventId:draft.eventId.trim(),eventBrief:text(draft.eventBrief),riskNote:text(draft.riskNote),
      directionId:draft.directionId,originalCategory:'',reason:text(draft.reason),angle:text(draft.angle),example:text(draft.example),
      sources:sources(draft.sources),sourceText:'',origin:'generated',status:'candidate',abandonReason:'',adoptNote:'',sourceDate:text(draft.sourceDate),
      sourceRunId:text(draft.sourceRunId),directionRevision:Number.isSafeInteger(draft.directionRevision)?draft.directionRevision:null,
      generatedAt:text(draft.generatedAt),sourceIds:Array.isArray(draft.sourceIds)?draft.sourceIds.filter(x=>typeof x==='string'):[]};
  }
  function hotTopics(rows){
    if(!Array.isArray(rows))return {items:[],skipped:1};
    const items=[],seen=new Set();let skipped=0;
    for(const row of rows)try{const data=candidate(row);if(!seen.has(data.dedupeKey)){seen.add(data.dedupeKey);items.push(data);}}catch(_){skipped++;}
    return {items,skipped};
  }
  function legacyFavorites(raw){
    if(raw===null)return [];
    const rows=typeof raw==='string'?JSON.parse(raw):raw;if(!Array.isArray(rows))throw new Error('旧选题收藏不是数组，原数据已保留');
    const grouped=new Map();
    for(const row of rows){
      const data=candidate(row,'legacy');data.legacyRecords=[JSON.parse(JSON.stringify(row))];
      if(grouped.has(data.dedupeKey))grouped.get(data.dedupeKey).legacyRecords.push(...data.legacyRecords);else grouped.set(data.dedupeKey,data);
    }
    return [...grouped.values()];
  }
  return Object.freeze({safeUrl,identity,sources,candidate,generated,hotTopics,legacyFavorites});
});
