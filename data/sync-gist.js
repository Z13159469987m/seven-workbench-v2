(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./sync-model.js'));
  else root.WorkbenchSyncGist=factory(root.WorkbenchSyncModel);
})(typeof self!=='undefined'?self:this,function(Model){
  'use strict';
  const PREFIX='workbench-v2-version-',MAX_VERSIONS=80;
  function fail(code,message){const e=new Error(message);e.code=code;throw e;}
  function filename(id){return PREFIX+id+'.json';}
  async function graph(files){
    const names=Object.keys(files).filter(n=>n.startsWith(PREFIX)&&n.endsWith('.json'));
    if(names.length>MAX_VERSIONS)fail('capacity','云端版本数量超过本版安全读取上限，已停止写入；版本未清理');
    const nodes=Object.create(null);
    for(const name of names){const e=await Model.parse(files[name]);if(name!==filename(e.versionId))fail('integrity','不可变版本文件名与内容不一致');nodes[e.versionId]=e;}
    let index=null;if(files[Model.FILENAME]!==undefined){index=await Model.parse(files[Model.FILENAME]);if(nodes[index.versionId]&&!Model.equal(nodes[index.versionId],index))fail('integrity','云端当前副本与不可变版本不一致');if(!nodes[index.versionId])fail('integrity','当前副本缺少对应不可变版本，不能安全判定历史');}
    const used=new Set();
    for(const node of Object.values(nodes)){
      for(const parent of node.parents){if(!nodes[parent])fail('integrity','云端版本链缺少父版本，停止处理');used.add(parent);}
      const expected=node.parents.length?Math.max(...node.parents.map(id=>nodes[id].syncVersion))+1:1;
      if(node.syncVersion!==expected)fail('integrity','云端版本链次序不合法');
    }
    const heads=Object.values(nodes).filter(n=>!used.has(n.versionId)).sort((a,b)=>a.versionId.localeCompare(b.versionId));
    if(Object.keys(nodes).length&&!heads.length)fail('integrity','云端版本链无法确定有效分支');
    return {nodes,heads,index,signature:heads.map(n=>n.versionId+':'+n.stateHash).join('|'),versionCount:names.length};
  }
  function create({http=globalThis.fetch.bind(globalThis),timeoutMs=20000}={}){
    async function request(cfg,method,body){
      if(!/^[a-f0-9]{5,64}$/i.test(cfg.gistId)||typeof cfg.token!=='string'||!cfg.token.trim())fail('config','请填写有效的Gist ID和Token');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const res=await http('https://api.github.com/gists/'+cfg.gistId,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+cfg.token,'X-GitHub-Api-Version':'2026-03-10',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});
        if(res.status===401)fail('auth','Token无效或已过期');
        if(res.status===429||(res.status===403&&(res.headers.get('x-ratelimit-remaining')==='0'||res.headers.get('retry-after'))))fail('rate','GitHub限流，请稍后手动重试');
        if(res.status===403)fail('permission','Token权限不足，或GitHub限制了本次请求');
        if(res.status===404)fail('missing-gist','Gist不存在，或当前Token无权访问');
        if(!res.ok)fail('http','GitHub请求失败（HTTP '+res.status+'）');
        let json;try{json=await res.json();}catch(_){fail('response','GitHub返回了非JSON响应');}
        if(!json||!json.files||typeof json.files!=='object'||Array.isArray(json.files))fail('response','GitHub响应缺少文件列表');
        if(json.truncated||Object.keys(json.files).length>=300)fail('truncated','Gist文件列表可能被截断，无法安全读取全部版本');return json;
      }catch(e){if(e.code)throw e;if(controller.signal.aborted)fail('timeout','GitHub请求超时；本地修改保留');fail('network','网络请求失败；本地修改保留');}finally{clearTimeout(timer);}
    }
    async function read(cfg){
      const json=await request(cfg,'GET'),files={};
      for(const [name,file] of Object.entries(json.files))if(name===Model.FILENAME||(name.startsWith(PREFIX)&&name.endsWith('.json'))){
        if(!file||file.truncated||typeof file.content!=='string')fail('truncated','V2版本文件内容被截断或不可读，已停止处理');
        files[name]=file.content;
      }
      return graph(files);
    }
    async function publish(cfg,e,expectedSignature){
      const value=await Model.parse(e),before=await read(cfg);
      if(before.signature!==expectedSignature)fail('changed','云端在确认后发生变化，请重新检查');
      if(before.versionCount>=MAX_VERSIONS)fail('capacity','已达到不可变版本保存上限，停止上传并保留现有版本');
      if(before.nodes[value.versionId])fail('collision','版本ID已存在，未覆盖不可变版本');
      if(!Model.equal([...value.parents].sort(),before.heads.map(h=>h.versionId).sort()))fail('parents','上传没有包含所有已知云端分支，已停止');
      const expected=before.heads.length?Math.max(...before.heads.map(h=>h.syncVersion))+1:1;
      if(value.syncVersion!==expected)fail('version','上传版本号不符合当前父版本');
      // Never PATCH another version file. Concurrent requests create distinct files;
      // the mutable index alone is deliberately not treated as the source of truth.
      await request(cfg,'PATCH',{files:{[filename(value.versionId)]:{content:JSON.stringify(value)},[Model.FILENAME]:{content:JSON.stringify(value)}}});
      const after=await read(cfg);
      if(!after.nodes[value.versionId]||!Model.equal(after.nodes[value.versionId],value))fail('verify','上传后不可变版本读取核验失败，未标记成功');
      if(after.heads.length!==1||after.heads[0].versionId!==value.versionId)fail('branch','检测到并发分支，所有版本已保留，需要处理冲突');
      return after;
    }
    return Object.freeze({read,publish});
  }
  return Object.freeze({PREFIX,MAX_VERSIONS,filename,graph,create});
});
