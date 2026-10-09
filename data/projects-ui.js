(function(root){
  'use strict';
  const model=root.WorkbenchProjectsModel;
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let host=null,service=null,current=null,archived=false,busy=false,dialog=null,notice='';
  const drafts=new Map();
  const active=()=>host&&host.querySelector('.p1-projects');
  function button(action,text,extra=''){return `<button type="button" class="p1-button${action==='delete'?' p1-danger':''}" data-action="${action}" ${extra}>${text}</button>`;}
  function status(text,error=false){
    notice=text;const node=dialog?.open?dialog.querySelector('.p1-dialog-message'):host?.querySelector('#p1Status');
    if(node){node.textContent=text;node.classList.toggle('p1-error',error);}
  }
  function setBusy(value){
    for(const scope of [active(),dialog])if(scope)scope.querySelectorAll('button,input,textarea').forEach(el=>{
      if(value){el.dataset.p1Disabled=String(el.disabled);el.disabled=true;}
      else if(el.dataset.p1Disabled!==undefined){el.disabled=el.dataset.p1Disabled==='true';delete el.dataset.p1Disabled;}
    });
  }
  function closeEditor(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
  async function perform(action,after){
    if(busy)return;busy=true;setBusy(true);status('正在保存…');
    try{
      const result=await action();busy=false;setBusy(false);closeEditor();notice='已保存';render();if(after)after(result);
    }catch(error){busy=false;setBusy(false);status(error.message+'。当前输入仍保留；如提示数据变化，请重新打开后核对。',true);}
  }
  function card(record,index,total){
    const d=record.data,todos=model.sortedTodos(d),projectId=esc(record.id);
    const rows=todos.map((t,i)=>`<li class="p1-todo" data-todo-id="${esc(t.id)}">
      <label class="p1-check"><input type="checkbox" data-action="todo-toggle" ${t.done?'checked':''} aria-label="${esc(t.text)}"><span class="${t.done?'p1-done':''}">${esc(t.text)}</span></label>
      <div class="p1-todo-actions">${button('todo-edit','编辑')}${button('todo-up','上移',i===0?'disabled':'')}${button('todo-down','下移',i===todos.length-1?'disabled':'')}${button('todo-delete','删除','aria-label="删除待办"')}</div>
    </li>`).join('');
    const show=value=>value?esc(value):'<span class="p1-muted">暂未填写</span>';
    return `<article class="p1-card" data-project-id="${projectId}">
      <header class="p1-card-head"><h3>${esc(d.name)}</h3>${button('edit','编辑项目')}</header>
      <dl class="p1-details"><div><dt>当前状态</dt><dd>${show(d.status)}</dd></div><div><dt>进度</dt><dd>${show(d.progressText)}</dd></div><div><dt>打算</dt><dd>${show(d.plan)}</dd></div></dl>
      <section class="p1-todos"><h4>待做清单</h4>${todos.length?`<ul>${rows}</ul>`:'<p class="p1-muted">还没有待办</p>'}
        <form class="p1-add-todo"><label>新增待办<input name="todoText" value="${esc(drafts.get(record.id)||'')}" placeholder="写下一件想做的事" autocomplete="off" required></label><button class="p1-button" type="submit">添加待办</button></form>
      </section>
      <footer class="p1-card-actions">${button('up','上移',index===0?'disabled':'')}${button('down','下移',index===total-1?'disabled':'')}${button(d.archived?'restore':'archive',d.archived?'恢复项目':'归档项目')}${button('delete','删除项目')}</footer>
    </article>`;
  }
  function render(){
    if(!host)return;
    try{current=service.snapshot();}catch(error){host.innerHTML=`<section class="p1-projects"><p class="p1-error" role="alert">${esc(error.message)}。没有改写项目数据。</p>${button('reload','重新读取')}</section>`;return;}
    const records=current.projects.filter(r=>r.data.archived===archived);
    host.innerHTML=`<section class="p1-projects" aria-label="项目管理">
      <div class="p1-toolbar"><div class="p1-tabs">${button('current','当前项目',`aria-pressed="${!archived}"`)}${button('archived','已归档项目',`aria-pressed="${archived}"`)}</div>${button('new','＋ 新建项目')}</div>
      <p id="p1Status" class="p1-status" role="status" aria-live="polite">${esc(notice)}</p>
      <div class="p1-cards">${records.length?records.map((r,i)=>card(r,i,records.length)).join(''):`<div class="p1-empty"><p>${archived?'还没有已归档项目':'现在还没有项目'}</p>${archived?'':button('new','＋ 新建第一个项目')}</div>`}</div>
    </section>`;
  }
  function openDialog(title,content,onSubmit,submitLabel='保存修改',danger=false){
    closeEditor();dialog=document.createElement('dialog');dialog.className='p1-dialog';dialog.setAttribute('aria-labelledby','p1DialogTitle');
    dialog.innerHTML=`<form><header><h3 id="p1DialogTitle">${esc(title)}</h3></header><div class="p1-form-body">${content}<p class="p1-dialog-message" role="status" aria-live="polite"></p></div><footer>${button('cancel','取消')}<button class="p1-button ${danger?'p1-danger':'p1-primary'}" type="submit">${submitLabel}</button></footer></form>`;
    document.body.appendChild(dialog);dialog.querySelector('[data-action="cancel"]').onclick=()=>{if(!busy){closeEditor();notice='';render();}};
    dialog.oncancel=event=>{event.preventDefault();if(!busy){closeEditor();notice='';render();}};
    dialog.querySelector('form').onsubmit=event=>{event.preventDefault();if(!busy)onSubmit(new FormData(event.currentTarget));};
    dialog.showModal();resizeDialog();
    dialog.querySelector('input,textarea,button')?.focus();
  }
  function openEdit(record,isNew=false){
    const d=model.normalize(record.data),fields=[['name','项目名称',isNew?'':d.name],['status','当前状态',d.status],['progressText','进度',d.progressText],['plan','打算',d.plan]];
    const content=fields.map(([key,label,value])=>`<label class="p1-field">${label}${key==='name'?`<input name="${key}" value="${esc(value)}" placeholder="项目名称" autocomplete="off">`:`<textarea name="${key}" rows="2">${esc(value)}</textarea>`}</label>`).join('');
    openDialog(isNew?'新项目':'编辑项目',content,form=>perform(()=>service.edit(record,Object.fromEntries(fields.map(([key])=>[key,form.get(key)])))));
  }
  function selected(element){const card=element.closest('[data-project-id]');return current?.projects.find(r=>r.id===card?.dataset.projectId);}
  function onClick(event){
    const target=event.target.closest('button[data-action]');if(!target||busy)return;const action=target.dataset.action;
    if(action==='reload'){notice='';render();return;}
    if(action==='current'||action==='archived'){archived=action==='archived';notice='';render();return;}
    if(action==='new'){perform(()=>service.create(),record=>{archived=false;render();openEdit(record,true);});return;}
    const record=selected(target);if(!record)return;
    if(action==='edit'){openEdit(record);return;}
    if(action==='archive'||action==='restore'){perform(()=>service.archive(record,action==='archive'));return;}
    if(action==='up'||action==='down'){perform(()=>service.move(current,record.id,action==='up'?-1:1,archived));return;}
    if(action==='delete'){
      openDialog('确认删除项目',`<p>确定删除“${esc(record.data.name)}”吗？该项目及其待办将退出项目列表。也可以先归档，之后随时恢复。</p>`,()=>perform(()=>service.remove(record,true)),'确认删除',true);return;
    }
    const todoId=target.closest('[data-todo-id]')?.dataset.todoId,todo=record.data.todos.find(t=>t.id===todoId);if(!todo)return;
    if(action==='todo-edit')openDialog('编辑待办',`<label class="p1-field">待办内容<textarea name="text" rows="3" required>${esc(todo.text)}</textarea></label>`,form=>perform(()=>service.editTodo(record,todoId,form.get('text'))));
    else if(action==='todo-delete')openDialog('删除待办',`<p>确定删除这条待办吗？</p><p>${esc(todo.text)}</p>`,()=>perform(()=>service.removeTodo(record,todoId)),'确认删除',true);
    else if(action==='todo-up'||action==='todo-down')perform(()=>service.moveTodo(record,todoId,action==='todo-up'?-1:1));
  }
  function onChange(event){
    if(event.target.dataset.action!=='todo-toggle'||busy)return;const record=selected(event.target),todoId=event.target.closest('[data-todo-id]').dataset.todoId,done=event.target.checked;
    // Reflect only persisted state; a failed write must not look like a completed task.
    event.target.checked=!done;perform(()=>service.toggleTodo(record,todoId,done));
  }
  function onSubmit(event){
    if(!event.target.matches('.p1-add-todo'))return;event.preventDefault();if(busy)return;
    const record=selected(event.target),text=new FormData(event.target).get('todoText');
    perform(()=>service.addTodo(record,text),()=>{drafts.delete(record.id);render();});
  }
  function onInput(event){if(event.target.name==='todoText'){const record=selected(event.target);if(record)drafts.set(record.id,event.target.value);}}
  function onStorage(event){
    if(event.key!==root.WorkbenchDataV2.STORAGE_KEY&&event.key!==null)return;if(!active()||busy)return;
    if(dialog?.open)status('另一页面的数据已变化，当前输入已保留。保存时会检查冲突。');
    else{notice='已读取最新项目';render();}
  }
  function resizeDialog(){if(dialog?.open)dialog.style.maxHeight=Math.max(160,(root.visualViewport?.height||root.innerHeight)-24)+'px';}
  function mount(target){
    leave();host=target;service=model.createService(root.WorkbenchDataV2.createStore(localStorage));archived=false;notice='';
    host.addEventListener('click',onClick);host.addEventListener('change',onChange);host.addEventListener('submit',onSubmit);host.addEventListener('input',onInput);
    root.addEventListener('storage',onStorage);root.visualViewport?.addEventListener('resize',resizeDialog);render();
  }
  function leave(){
    if(busy)return;closeEditor();
    if(host){host.removeEventListener('click',onClick);host.removeEventListener('change',onChange);host.removeEventListener('submit',onSubmit);host.removeEventListener('input',onInput);}
    root.removeEventListener('storage',onStorage);root.visualViewport?.removeEventListener('resize',resizeDialog);host=null;
  }
  root.WorkbenchProjectsUI=Object.freeze({mount,leave,canLeave:()=>!busy});
})(window);
