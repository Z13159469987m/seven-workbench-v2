(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkbenchFavoritesModel=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const VERSION=1,own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),clone=x=>JSON.parse(JSON.stringify(x)),text=x=>typeof x==='string'?x:'';
  function need(ok,message){if(!ok)throw new Error(message);}
  function href(raw){try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch(_){return null;}}
  function checkUrl(raw){
    need(typeof raw==='string'&&raw.trim().length>0,'请填写链接');
    need(!/^\s*(javascript|data|file|vbscript):/i.test(raw),'请使用网页链接');
    let u;try{u=new URL(raw);}catch(_){return;}
    need(!u.username&&!u.password,'链接不能包含账号密码');
    for(const key of u.searchParams.keys())need(!/^(api[_-]?key|access[_-]?token|refresh[_-]?token|github[_-]?token|password|authorization|secret)$/i.test(key),'链接不能包含敏感凭据参数');
  }
  function platform(raw){
    const url=href(raw);if(!url)return '未知来源';const host=new URL(url).hostname.toLowerCase(),is=d=>host===d||host.endsWith('.'+d);
    if(['xiaohongshu.com','xhslink.com','xhslink.cn'].some(is))return '小红书';
    if(['douyin.com','iesdouyin.com'].some(is))return '抖音';if(is('douban.com'))return '豆瓣';
    if(['bilibili.com','b23.tv'].some(is))return 'B站';return '普通网页';
  }
  function tags(value){need(Array.isArray(value)&&value.every(v=>typeof v==='string'),'标签应为文本列表');return [...new Set(value.map(v=>v.trim()).filter(Boolean))];}
  function validate(collection,data){
    need(data.favoriteSchemaVersion===VERSION,'收藏数据版本不受支持');
    need(Number.isSafeInteger(data.order)&&data.order>=0,'收藏排序不合法');need(typeof data.origin==='string','收藏来源不合法');
    if(collection==='favoriteGroups'){
      need(typeof data.name==='string'&&data.name.trim().length>0,'收藏夹名称不能为空');need(typeof data.description==='string'&&typeof data.archived==='boolean','收藏夹字段不合法');
    }else{
      checkUrl(data.url);for(const k of ['title','source','summary','note'])need(typeof data[k]==='string','收藏字段 '+k+' 应为文本');
      need(Array.isArray(data.tags)&&data.tags.every(t=>typeof t==='string'&&t.trim().length>0)&&new Set(data.tags).size===data.tags.length,'标签不合法');
      for(const k of ['groupId','projectId'])need(data[k]===null||(typeof data[k]==='string'&&data[k].length>0),'收藏关联不合法');
      need(typeof data.inbox==='boolean','待整理状态不合法');
    }
    return data;
  }
  function groupData(d={}){return {...clone(d),favoriteSchemaVersion:VERSION,name:text(d.name)||'未命名收藏夹',description:text(d.description)||text(d.note),archived:typeof d.archived==='boolean'?d.archived:false,order:Number.isSafeInteger(d.order)&&d.order>=0?d.order:0,origin:text(d.origin)||'v2-previous'};}
  function favoriteData(d={}){return {...clone(d),favoriteSchemaVersion:VERSION,url:text(d.url),title:text(d.title),source:text(d.source)||platform(d.url),summary:text(d.summary),note:text(d.note)||text(d.notes),tags:tags(d.tags||[]),groupId:text(d.groupId)||null,projectId:text(d.projectId)||null,inbox:typeof d.inbox==='boolean'?d.inbox:true,order:Number.isSafeInteger(d.order)&&d.order>=0?d.order:0,origin:text(d.origin)||'v2-previous'};}
  const compare=(a,b)=>a.data.order-b.data.order||a.id.localeCompare(b.id);
  async function hash(prefix,value){const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return prefix+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
  async function legacy(raw){
    if(raw===null)return {groups:[],favorites:[]};const rows=typeof raw==='string'?JSON.parse(raw):raw;need(Array.isArray(rows),'旧收藏分组不是数组');
    const groups=[],favorites=[],gids=new Set(),fids=new Set();
    for(const [gi,g] of rows.entries()){
      need(g&&typeof g.name==='string'&&Array.isArray(g.items),'旧收藏夹结构不完整');
      const groupKey=text(g.id)||'index:'+gi,gid=await hash('legacy-favgroup-',groupKey);need(!gids.has(gid),'旧收藏夹ID重复，未导入');gids.add(gid);
      const {items,...meta}=g;
      groups.push({id:gid,data:groupData({name:g.name,description:text(g.note),order:gi,origin:'legacy',legacy:meta})});
      for(const [ii,it] of g.items.entries()){
        need(it&&typeof it.url==='string'&&it.url.trim(),'旧收藏缺少链接');
        const key=JSON.stringify([groupKey,text(it.id)||'index:'+ii]),id=await hash('legacy-favorite-',key);need(!fids.has(id),'旧收藏ID重复，未导入');fids.add(id);
        favorites.push({id,data:favoriteData({url:it.url,title:text(it.title),source:text(it.source),summary:text(it.summary),note:text(it.note),tags:[...new Set([text(g.category),text(it.category)].filter(x=>x&&x!=='未分类'))],groupId:gid,projectId:null,inbox:true,order:ii,origin:'legacy',legacy:clone(it)})});
      }
    }
    for(const g of groups)validate('favoriteGroups',g.data);for(const f of favorites)validate('favorites',f.data);return {groups,favorites};
  }
  function createService(store){
    function snapshot(){const s=store.load();return {revision:s.revision,groups:s.collections.favoriteGroups.map(r=>({...r,data:groupData(r.data)})).sort(compare),favorites:s.collections.favorites.map(r=>({...r,data:favoriteData(r.data)})),projects:s.collections.projects};}
    function put(c,r,d){validate(c,d);return store.put(c,d,r?{recordId:r.id,expectedRevision:r.revision}:{});}
    function projectLabel(snapshot,id){if(!id)return '未关联项目';const r=snapshot.projects.find(r=>r.id===id);return r?r.data.name+(r.deletedAt?'（已删除）':r.data.archived?'（已归档）':''):'项目不可用';}
    function groupLabel(snapshot,id){if(!id)return '未分类';const r=snapshot.groups.find(r=>r.id===id);return r?r.data.name+(r.deletedAt?'（已删除）':r.data.archived?'（已归档）':''):'收藏夹不可用';}
    return Object.freeze({snapshot,projectLabel,groupLabel,
      create(url,note=''){checkUrl(url);const d=favoriteData({url:url.trim(),note,origin:'manual'});d.order=Date.now();return store.saveFavorite(d);},
      edit(r,fields){need(r.deletedAt===null,'收藏已删除');const d=favoriteData(r.data);for(const k of ['url','title','source','summary','note','groupId','projectId','inbox'])if(own(fields,k))d[k]=fields[k];if(own(fields,'tags'))d.tags=tags(fields.tags);validate('favorites',d);return store.saveFavorite(d,r.id,r.revision);},
      remove(r,confirmed){need(confirmed===true,'删除收藏需要再次确认');return store.remove('favorites',r.id,r.revision);},
      createGroup(fields){const s=snapshot(),d=groupData({name:fields.name,description:fields.description,origin:'manual'});d.order=s.groups.length?Math.max(...s.groups.map(g=>g.data.order))+1:0;need(text(fields.name).trim(),'收藏夹名称不能为空');d.name=fields.name.trim();return put('favoriteGroups',null,d);},
      editGroup(r,fields){need(r.deletedAt===null,'收藏夹已删除');const d=groupData(r.data);for(const k of ['name','description','archived'])if(own(fields,k))d[k]=fields[k];d.name=d.name.trim();return put('favoriteGroups',r,d);},
      removeGroup(r,confirmed){need(confirmed===true,'删除收藏夹需要再次确认');return store.removeFavoriteGroup(r.id,r.revision);},
      moveGroup(s,id,delta){need(delta===1||delta===-1,'排序方向不合法');const rows=s.groups.filter(r=>!r.deletedAt),i=rows.findIndex(r=>r.id===id),j=i+delta;need(i>=0&&j>=0&&j<rows.length,'收藏夹已在边界或列表已变化');const ids=rows.map(r=>r.id);[ids[i],ids[j]]=[ids[j],ids[i]];return store.reorderFavoriteGroups(ids,s.revision);},
      async importLegacy(raw){return store.importFavoriteLegacy(await legacy(raw));},
      search(s,query){const terms=query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return s.favorites.filter(r=>!r.deletedAt&&terms.every(q=>[r.data.title,r.data.url,r.data.summary,r.data.note,...r.data.tags,groupLabel(s,r.data.groupId)].join('\n').normalize('NFKC').toLocaleLowerCase().includes(q))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.createdAt.localeCompare(a.createdAt)||b.data.order-a.data.order||a.id.localeCompare(b.id));}
    });
  }
  return Object.freeze({VERSION,href,checkUrl,platform,tags,validate,groupData,favoriteData,legacy,createService});
});
