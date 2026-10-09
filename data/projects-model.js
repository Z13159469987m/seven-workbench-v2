/* Project payload and operations. Persistence is delegated to the P0 store. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.WorkbenchProjectsModel=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const VERSION=1,clone=x=>JSON.parse(JSON.stringify(x));
  function need(ok,message){if(!ok)throw new Error(message);}
  function validate(data){
    need(data.projectSchemaVersion===VERSION,'项目数据版本不受支持');
    for(const key of ['name','status','progressText','plan'])need(typeof data[key]==='string','项目字段 '+key+' 应为文本');
    need(data.name.trim().length>0,'项目名称不能为空');
    need(Number.isSafeInteger(data.order),'项目排序应为安全整数');
    need(typeof data.archived==='boolean','项目归档标记应为布尔值');
    need(Array.isArray(data.todos),'项目待办应为数组');
    const ids=new Set();
    for(const todo of data.todos){
      need(todo&&typeof todo.id==='string'&&todo.id.length>0&&!ids.has(todo.id),'待办ID缺失或重复');ids.add(todo.id);
      need(typeof todo.text==='string'&&todo.text.trim().length>0,'待办内容不能为空');
      need(typeof todo.done==='boolean'&&Number.isSafeInteger(todo.order),'待办状态或排序不合法');
    }
    return data;
  }
  function blank(order=0){return {projectSchemaVersion:VERSION,name:'未命名项目',status:'',progressText:'',plan:'',todos:[],order,archived:false};}
  function normalize(data){
    // Earlier P0 project fields (for example progress history) remain intact.
    const result={...blank(),...clone(data),projectSchemaVersion:data.projectSchemaVersion??VERSION};
    validate(result);return result;
  }
  function compare(a,b){return a.order-b.order||(a.id<b.id?-1:a.id>b.id?1:0);}
  function sortedTodos(data){return [...data.todos].sort(compare);}
  function createService(store,{id=()=>crypto.randomUUID()}={}){
    function snapshot(){
      const state=store.load();
      const projects=state.collections.projects.filter(r=>r.deletedAt===null).map(r=>({...r,data:normalize(r.data)}));
      projects.sort((a,b)=>compare({...a.data,id:a.id},{...b.data,id:b.id}));
      return {revision:state.revision,projects};
    }
    function save(record,data){
      need(record&&record.deletedAt===null,'项目已删除，请刷新列表');validate(data);
      return store.put('projects',data,{recordId:record.id,expectedRevision:record.revision});
    }
    function changeTodos(record,edit){
      const data=normalize(record.data),todos=sortedTodos(data).map(clone);edit(todos);
      data.todos=todos.map((t,order)=>({...t,order}));return save(record,data);
    }
    function findTodo(todos,todoId){const index=todos.findIndex(t=>t.id===todoId);need(index>=0,'待办已变化，请刷新列表');return index;}
    return Object.freeze({snapshot,
      create(){const current=snapshot().projects;const order=current.length?Math.max(...current.map(r=>r.data.order))+1:0;return store.put('projects',blank(order));},
      edit(record,fields){
        const data=normalize(record.data);
        for(const key of ['name','status','progressText','plan'])if(Object.prototype.hasOwnProperty.call(fields,key))data[key]=fields[key];
        data.name=data.name.trim()||'未命名项目';return save(record,data);
      },
      archive(record,archived){need(typeof archived==='boolean','归档状态不合法');return save(record,{...normalize(record.data),archived});},
      remove(record,confirmed){need(confirmed===true,'删除项目需要再次确认');return store.remove('projects',record.id,record.revision);},
      move(current,recordId,direction,archived){
        need(direction===-1||direction===1,'排序方向不合法');
        const visible=current.projects.filter(r=>r.data.archived===archived),index=visible.findIndex(r=>r.id===recordId),next=index+direction;
        need(index>=0&&next>=0&&next<visible.length,'项目已在边界或列表已变化');
        const all=current.projects.map(r=>r.id),a=all.indexOf(visible[index].id),b=all.indexOf(visible[next].id);
        [all[a],all[b]]=[all[b],all[a]];return store.reorderProjects(all,current.revision);
      },
      addTodo(record,text){need(typeof text==='string'&&text.trim().length>0,'请填写待办内容');return changeTodos(record,todos=>todos.push({id:id(),text:text.trim(),done:false,order:todos.length}));},
      editTodo(record,todoId,text){need(typeof text==='string'&&text.trim().length>0,'请填写待办内容');return changeTodos(record,todos=>{todos[findTodo(todos,todoId)].text=text.trim();});},
      toggleTodo(record,todoId,done){need(typeof done==='boolean','待办状态不合法');return changeTodos(record,todos=>{todos[findTodo(todos,todoId)].done=done;});},
      removeTodo(record,todoId){return changeTodos(record,todos=>todos.splice(findTodo(todos,todoId),1));},
      moveTodo(record,todoId,direction){need(direction===-1||direction===1,'排序方向不合法');return changeTodos(record,todos=>{
        const i=findTodo(todos,todoId),j=i+direction;need(j>=0&&j<todos.length,'待办已在列表边界');[todos[i],todos[j]]=[todos[j],todos[i]];
      });}
    });
  }
  return Object.freeze({VERSION,validate,blank,normalize,sortedTodos,createService});
});
