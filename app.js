'use strict';
const API_BASE = String(window.FRIENDMAIL_API_BASE || '').replace(/\/+$/, '');
const TOKEN_KEY = 'friendmail_session';
const THEME_KEY = 'friendmail_theme';
const KEY_PREFIX = 'friendmail_';
const $ = id => document.getElementById(id);
const state = {mode:'login', folder:'inbox', messages:[], filteredMessages:[], user:null, selectedMessage:null, folderSerial:0, friendsSerial:0, friendsTimer:null};

function token() {return localStorage.getItem(TOKEN_KEY);}
function setToken(value) {if (value) localStorage.setItem(TOKEN_KEY,value); else localStorage.removeItem(TOKEN_KEY);}
function userKey(suffix) {return `${KEY_PREFIX}${suffix}_${state.user?.username || 'anonymous'}`;}
function escapeHtml(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function validUsername(name) {return /^[a-z0-9_]{3,24}$/i.test(name || '');}

async function api(path, options={}) {
  if (!/^https:\/\//.test(API_BASE) && !/^http:\/\/localhost(?::\d+)?\/api$/.test(API_BASE)) {
    throw new Error('API URL not configured. Edit config.js to point to your deployed Worker /api URL.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),15000);
  const headers = {...(options.body ? {'Content-Type':'application/json'} : {}),...(options.headers || {})};
  if (token()) headers.Authorization = `Bearer ${token()}`;
  try {
    let response;
    try {response = await fetch(`${API_BASE}${path}`,{...options,headers,signal:controller.signal});}
    catch(error) {
      if (error.name === 'AbortError') throw new Error('The API timed out. Check that your Cloudflare Worker is online.');
      throw new Error('Cannot reach the API. Check your Worker URL in config.js, its deployment, and ALLOWED_ORIGINS (CORS).');
    }
    const raw = await response.text();
    let data;
    try {data = raw ? JSON.parse(raw) : {};}
    catch {throw new Error(`Unexpected API response (${response.status}). Confirm config.js points to the Worker /api endpoint.`);}
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {clearTimeout(timeout);}
}
function getList(key) {
  try {const data=JSON.parse(localStorage.getItem(userKey(key)));return Array.isArray(data)?data:[];}
  catch {return [];}
}
function getContacts() {return getList('contacts');}
function addContact(name) {
  if (!validUsername(name) || name.toLowerCase() === state.user?.username) return;
  const contacts = getContacts();
  if (!contacts.includes(name.toLowerCase())) {
    contacts.push(name.toLowerCase());
    localStorage.setItem(userKey('contacts'),JSON.stringify(contacts.slice(-200)));
    renderContacts();
  }
}
function renderContacts() {
  const list=$('contacts-list');list.replaceChildren();
  for (const name of getContacts()) {const option=document.createElement('option');option.value=name;list.appendChild(option);}
}
function getReadMessages() {return getList('read_messages');}
function getMessageId(message) {return String(message.id ?? `${message.created_at}:${message.from}:${message.to}:${message.subject}`);}
function initials(name) {return (String(name || '?').replace(/^@/,'')[0] || '?').toUpperCase();}
function formatDate(value) {
  const date=new Date(value);if (Number.isNaN(date.getTime())) return '';
  return date.toDateString()===new Date().toDateString()
    ?date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})
    :date.toLocaleDateString([],{month:'short',day:'numeric'});
}

// All message HTML is re-built from an allowlist; never insert untrusted attributes or raw scripts.
function sanitizeRichText(raw) {
  const template=document.createElement('template');template.innerHTML=String(raw || '');
  const output=document.createElement('div');
  const safe=new Set(['b','strong','i','em','u','s','strike','p','div','br','blockquote','ul','ol','li','a','span','h3','h4']);
  const drop=new Set(['script','style','iframe','object','embed','svg','math','form','input','button','img','video','audio','link','meta']);
  function append(node,parent) {
    if (node.nodeType===Node.TEXT_NODE) {parent.appendChild(document.createTextNode(node.textContent));return;}
    if (node.nodeType!==Node.ELEMENT_NODE) return;
    const tag=node.localName.toLowerCase();if (drop.has(tag)) return;
    const target=safe.has(tag)?document.createElement(tag):parent;
    if (tag==='a' && target!==parent) {
      const link=node.getAttribute('href');
      if (link) {try {
        const url=new URL(link,location.href);
        if (['https:','http:','mailto:'].includes(url.protocol)) {
          target.setAttribute('href',url.href);
          target.setAttribute('target','_blank');target.setAttribute('rel','noopener noreferrer');
        }
      } catch {/* discard invalid URL */}}
    }
    if (target!==parent) parent.appendChild(target);
    for (const child of node.childNodes) append(child,target);
  }
  for (const child of template.content.childNodes) append(child,output);
  return output.innerHTML;
}
function avatarSrc(user) {
  if (!user || !validUsername(user.username) || !Number.isSafeInteger(Number(user.avatar_version)) || Number(user.avatar_version)<=0) return '';
  return `${API_BASE}/avatars/${encodeURIComponent(user.username)}?v=${Number(user.avatar_version)}`;
}
function setAvatar(el,user) {
  el.textContent=initials(user?.username);
  const src=avatarSrc(user);if (!src) return;
  const img=document.createElement('img');img.alt='';img.src=src;img.loading='lazy';
  img.addEventListener('error',()=>img.remove(),{once:true});el.appendChild(img);
}
function avatarHtml(user,extra='') {
  const src=avatarSrc(user);
  return `<span class="avatar ${extra}">${escapeHtml(initials(user.username))}${src?`<img src="${escapeHtml(src)}" alt="" loading="lazy">`:''}</span>`;
}
let toastTimeout;
function showNotice(message,isError=false) {
  const el=$('status-message');el.textContent=message;
  el.style.backgroundColor=isError?'var(--sys-error)':'var(--pm-purple)';el.style.color='#fff';
  el.hidden=!message;clearTimeout(toastTimeout);
  if (message) toastTimeout=setTimeout(()=>el.hidden=true,4500);
}
function showAuth() {
  $('auth-view').hidden=false;$('mail-view').hidden=true;
  if (state.friendsTimer) {clearInterval(state.friendsTimer);state.friendsTimer=null;}
}
function setMode(mode) {
  state.mode=mode;const login=mode==='login';
  $('login-tab').classList.toggle('active',login);$('register-tab').classList.toggle('active',!login);
  $('auth-title').textContent=login?'Sign in':'Create your account';
  $('auth-description').textContent=login?'Continue to your inbox':'Join FriendMail today';
  $('auth-submit').textContent=login?'Sign in':'Create account';
  $('password').autocomplete=login?'current-password':'new-password';
  $('password-help').hidden=login;$('auth-error').hidden=true;
}
function showMail() {
  $('auth-view').hidden=true;$('mail-view').hidden=false;
  $('signed-in-as').textContent=`@${state.user.username}`;
  setAvatar($('signed-in-avatar'),state.user);renderContacts();
  for (const id of ['friends-suggestions','friends-accepted','friends-incoming','friends-outgoing']) $(id).replaceChildren();
  $('requests-count').hidden=true;
  if (!state.friendsTimer) state.friendsTimer=setInterval(()=>{
    if (state.user && !document.hidden) loadFriends(true);
  },45000);
}
function renderSkeletons() {
  $('message-list').innerHTML=Array(5).fill('<div class="skeleton-row"><div class="skeleton-box" style="width:24px;border-radius:50%"></div><div class="skeleton-box" style="width:140px"></div><div class="skeleton-box" style="flex:1"></div><div class="skeleton-box" style="width:65px"></div></div>').join('');
}
function updateSearch() {
  const query=$('message-search').value.trim().toLowerCase();
  state.filteredMessages=state.messages.filter(m=>[m.from,m.to,m.subject,m.body,m.preview].some(value=>String(value || '').toLowerCase().includes(query)));
  renderMessages();
}
function showFolder(folder) {
  state.folder=folder;
  document.querySelectorAll('.folder').forEach(btn=>btn.classList.toggle('active',btn.dataset.folder===folder));
  const isFriends=folder==='friends';
  $('message-list').hidden=isFriends;
  $('friends-view').hidden=!isFriends;
  $('header-search').hidden=isFriends;
  $('message-total').textContent='';
}
async function loadFolder(folder=state.folder) {
  const serial=++state.folderSerial;
  showFolder(folder);
  if (folder==='friends') return loadFriends();
  $('message-search').value='';renderSkeletons();
  try {
    const data=await api(folder==='inbox'?'/inbox':'/sent');
    if (serial!==state.folderSerial || state.folder!==folder || !state.user) return;
    if (!Array.isArray(data.messages)) throw new Error('The server returned an invalid message list.');
    state.messages=data.messages;
    for (const m of state.messages) {addContact(m.from);addContact(m.to);}
    if (folder==='inbox') updateInboxBadge();
    updateSearch();
  } catch(error) {
    if (serial!==state.folderSerial || !state.user) return;
    if (error.status===401) {expireSession();return;}
    $('message-list').replaceChildren();const message=document.createElement('div');
    message.className='empty-state';message.textContent=`Unable to load ${folder}: ${error.message}`;
    $('message-list').appendChild(message);showNotice(error.message,true);
  }
}
function updateInboxBadge() {
  if (state.folder!=='inbox') return;
  const read=getReadMessages(),unread=state.messages.filter(m=>!read.includes(getMessageId(m))).length;
  $('inbox-count').textContent=unread?String(unread):'';
  $('inbox-count').hidden=!unread;
}
function renderMessages() {
  const list=$('message-list'),messages=state.filteredMessages;
  $('message-total').textContent=messages.length?`${messages.length} message${messages.length===1?'':'s'}`:'';
  if (!messages.length) {list.innerHTML='<div class="empty-state">No messages here yet.</div>';return;}
  const read=getReadMessages();
  list.innerHTML=messages.map((m,index)=>{
    const who=state.folder==='inbox'?m.from:`To: ${m.to}`;
    const preview=String(m.preview || m.body || '').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').slice(0,90);
    const unread=state.folder==='inbox' && !read.includes(getMessageId(m));
    return `<div class="message-row ${unread?'unread':''}" data-index="${index}" role="button" tabindex="0">
      <div class="msg-icons"><span class="material-symbols-outlined" style="font-size:20px">${unread?'':'mail'}</span></div>
      <div class="msg-sender">${escapeHtml(who)}</div>
      <div class="msg-content"><span class="msg-subject">${escapeHtml(m.subject || '(No subject)')}</span><span class="msg-snippet"> — ${escapeHtml(preview)}</span></div>
      <div class="msg-date">${escapeHtml(formatDate(m.created_at))}</div>
      <div class="msg-actions"><button class="icon-btn small action-del" type="button" title="Delete message" aria-label="Delete message"><span class="material-symbols-outlined">delete</span></button></div>
      </div>`;
  }).join('');
}
async function deleteMessage(message) {
  if (!message || !confirm('Delete this message from your account?')) return;
  if (!message.id) {showNotice('This message has no server ID; update your Worker.',true);return;}
  try {
    await api(`/messages/${encodeURIComponent(message.id)}`,{method:'DELETE'});
    state.messages=state.messages.filter(m=>m!==message);
    updateInboxBadge();updateSearch();showNotice('Message deleted.');
  } catch(error) {showNotice(error.message,true);}
}
function openMessage(message) {
  if (!message) return;
  state.selectedMessage=message;
  if (state.folder==='inbox') {
    const id=getMessageId(message),read=getReadMessages();
    if (!read.includes(id)) {read.push(id);localStorage.setItem(userKey('read_messages'),JSON.stringify(read.slice(-2000)));updateInboxBadge();renderMessages();}
  }
  $('detail-meta').textContent=formatDate(message.created_at);
  $('detail-subject').textContent=message.subject || '(No subject)';
  const person=state.folder==='inbox'?message.from:message.to;
  $('detail-from').textContent=`@${person}`;
  setAvatar($('detail-avatar'),{username:person,avatar_version:state.folder==='inbox'?message.sender_avatar_version:message.recipient_avatar_version});
  $('detail-body').innerHTML=sanitizeRichText(message.body);
  $('reply-button').hidden=state.folder!=='inbox';
  $('message-dialog').showModal();
}
async function enterApp() {
  const data=await api('/me');if (!data?.user?.username) throw new Error('Invalid account response.');
  state.user=data.user;showMail();await loadFolder('inbox');
}
function expireSession() {
  setToken(null);state.user=null;state.messages=[];state.filteredMessages=[];
  ++state.folderSerial;++state.friendsSerial;showAuth();setMode('login');
  $('auth-error').textContent='Session expired. Please sign in again.';$('auth-error').hidden=false;
}

// Friends: returned by the server and shared across accounts, never stored as fake local data.
function renderPerson(user,actions,subtitle) {
  const buttons=actions.map(({action,label,secondary})=>`<button type="button" class="mini-btn ${secondary?'secondary':''}" data-action="${action}" data-username="${escapeHtml(user.username)}" ${user.id?`data-id="${Number(user.id)}"`:''}>${escapeHtml(label)}</button>`).join('');
  return `<div class="person-row">${avatarHtml(user,'large')}<span class="person-name"><strong>@${escapeHtml(user.username)}</strong>${subtitle?`<small>${escapeHtml(subtitle)}</small>`:''}</span><span class="person-actions">${buttons}</span></div>`;
}
function renderFriendCollection(id,rows,actions,empty) {
  $(id).innerHTML=rows.length?rows.map(u=>renderPerson(u,actions,u.created_at?`Requested ${formatDate(u.created_at)}`:'' )).join(''):`<div class="friends-empty">${escapeHtml(empty)}</div>`;
}
async function loadFriends(quiet=false) {
  if (!state.user) return;
  const serial=++state.friendsSerial;
  if (!quiet) $('friends-suggestions').innerHTML='<div class="friends-empty">Finding people…</div>';
  try {
    const data=await api('/friends/overview');
    if (serial!==state.friendsSerial || !state.user) return;
    for (const key of ['suggestions','friends','incoming','outgoing']) if (!Array.isArray(data[key])) throw new Error('Unexpected Friends API response.');
    renderFriendCollection('friends-suggestions',data.suggestions,[{action:'request',label:'Send Friend Request'}],'No more people to suggest right now.');
    renderFriendCollection('friends-accepted',data.friends,[{action:'message',label:'Message'},{action:'remove',label:'Remove',secondary:true}],'No friends yet. Send an invitation!');
    renderFriendCollection('friends-incoming',data.incoming,[{action:'accept',label:'Accept'},{action:'decline',label:'Decline',secondary:true}],'No incoming requests.');
    renderFriendCollection('friends-outgoing',data.outgoing,[{action:'cancel',label:'Cancel request',secondary:true}],'No pending requests.');
    $('friends-total').textContent=data.friends.length?`(${data.friends.length})`:'';
    $('incoming-total').textContent=data.incoming.length?`(${data.incoming.length})`:'';
    $('outgoing-total').textContent=data.outgoing.length?`(${data.outgoing.length})`:'';
    $('requests-count').textContent=String(data.incoming.length);
    $('requests-count').hidden=!data.incoming.length;
  } catch(error) {
    if (serial!==state.friendsSerial || !state.user) return;
    if (error.status===401) {expireSession();return;}
    if (!quiet) $('friends-suggestions').innerHTML=`<div class="friends-empty">${escapeHtml(error.message)}</div>`;
    showNotice(error.message,true);
  }
}
async function friendAction(button) {
  const action=button.dataset.action,username=button.dataset.username,id=button.dataset.id;
  if (!validUsername(username)) return;
  if (action==='message') {openCompose({to:username});return;}
  if (action==='remove' && !confirm(`Remove @${username} from your friends?`)) return;
  button.disabled=true;
  try {
    if (action==='request') await api('/friends/requests',{method:'POST',body:JSON.stringify({username})});
    else if (action==='remove') await api(`/friends/${encodeURIComponent(username)}`,{method:'DELETE'});
    else if (['accept','decline','cancel'].includes(action) && /^\d+$/.test(id || '')) await api(`/friends/requests/${id}`,{method:'POST',body:JSON.stringify({action})});
    else return;
    showNotice({request:'Friend request sent.',remove:'Friend removed.',accept:'You are now friends!',decline:'Request declined.',cancel:'Request cancelled.'}[action]);
    await loadFriends();
  } catch(error) {showNotice(error.message,true);} finally {button.disabled=false;}
}

function openCompose({to='',subject=''}={}) {
  $('compose-error').hidden=true;$('compose-form').reset();
  $('recipient').value=to;$('subject').value=subject;
  $('body').innerHTML=to||subject?'':sanitizeRichText(localStorage.getItem(userKey('draft')) || '');
  if (!$('compose-dialog').open) $('compose-dialog').show();
  setTimeout(()=>$('recipient').focus(),40);
}
function applyTheme(theme) {
  document.body.classList.toggle('dark',theme==='dark');
  $('theme-toggle').innerHTML=`<span class="material-symbols-outlined">${theme==='dark'?'light_mode':'dark_mode'}</span>`;
  localStorage.setItem(THEME_KEY,theme);
}
function openProfile() {
  if (!state.user) return;
  $('profile-name').textContent=`@${state.user.username}`;
  setAvatar($('profile-avatar'),state.user);
  $('avatar-remove').hidden=!state.user.avatar_version;
  $('profile-dialog').showModal();
}
async function convertPng(file) {
  if (file.type!=='image/png' || !file.name.toLowerCase().endsWith('.png')) throw new Error('Please select a PNG file.');
  if (file.size>2*1024*1024) throw new Error('PNG must be 2 MB or smaller.');
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();
    image.src=url;await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid PNG image.');
    const canvas=document.createElement('canvas');
    for (const size of [192,160,128,96]) {
      canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d');ctx.clearRect(0,0,size,size);
      const scale=Math.max(size/image.naturalWidth,size/image.naturalHeight);
      const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
      ctx.drawImage(image,(size-width)/2,(size-height)/2,width,height);
      const data=canvas.toDataURL('image/png');
      if (Math.ceil((data.length-'data:image/png;base64,'.length)*3/4)<=140*1024) return data;
    }
    throw new Error('This image is too complex to fit the avatar size limit.');
  } finally {URL.revokeObjectURL(url);}
}

$('sidebar-toggle').addEventListener('click',()=>$('app-sidebar').classList.toggle('collapsed'));
$('login-tab').addEventListener('click',()=>setMode('login'));
$('register-tab').addEventListener('click',()=>setMode('register'));
$('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();$('auth-error').hidden=true;
  const username=$('username').value.trim(),password=$('password').value;
  const submit=$('auth-submit');submit.disabled=true;submit.textContent='Connecting…';
  try {
    const data=await api(state.mode==='login'?'/login':'/register',{method:'POST',body:JSON.stringify({username,password})});
    if (!data.token || !data.user?.username) throw new Error('Invalid login response from the API.');
    setToken(data.token);state.user=data.user;$('password').value='';showMail();await loadFolder('inbox');
  } catch(error) {$('auth-error').textContent=error.message;$('auth-error').hidden=false;}
  finally {submit.disabled=false;submit.textContent=state.mode==='login'?'Sign in':'Create account';}
});
$('logout-button').addEventListener('click',async()=>{
  const oldToken=token();setToken(null);
  state.user=null;state.messages=[];state.filteredMessages=[];++state.folderSerial;++state.friendsSerial;
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());showAuth();setMode('login');
  if (oldToken) {
    // The token was cleared locally immediately; revoke the server session separately.
    try {
      const response=await fetch(`${API_BASE}/logout`,{method:'POST',headers:{Authorization:`Bearer ${oldToken}`}});
      if (!response.ok) showNotice('Signed out locally; server session could not be revoked.',true);
    } catch {showNotice('Signed out locally; server session could not be revoked.',true);}
  }
});
document.querySelectorAll('.folder').forEach(btn=>btn.addEventListener('click',()=>loadFolder(btn.dataset.folder)));
$('refresh-button').addEventListener('click',()=>state.folder==='friends'?loadFriends():loadFolder());
$('message-search').addEventListener('input',updateSearch);
$('message-list').addEventListener('click',event=>{
  const row=event.target.closest('.message-row');if (!row) return;
  const message=state.filteredMessages[Number(row.dataset.index)];
  if (event.target.closest('.action-del')) {event.stopPropagation();deleteMessage(message);} else openMessage(message);
});
$('message-list').addEventListener('keydown',event=>{
  if (!['Enter',' '].includes(event.key) || event.target.closest('button')) return;
  const row=event.target.closest('.message-row');if (!row) return;
  event.preventDefault();openMessage(state.filteredMessages[Number(row.dataset.index)]);
});
$('friends-view').addEventListener('error',event=>{
  if (event.target.matches('.avatar img')) event.target.remove();
},true);
$('friends-view').addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');if (button) friendAction(button);
});
$('friend-search-form').addEventListener('submit',async event=>{
  event.preventDefault();const input=$('friend-username');const username=input.value.trim().toLowerCase();
  const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
  try {await api('/friends/requests',{method:'POST',body:JSON.stringify({username})});input.value='';showNotice('Friend request sent.');await loadFriends();}
  catch(error) {showNotice(error.message,true);} finally {button.disabled=false;}
});
$('compose-open').addEventListener('click',()=>openCompose());
$('compose-close').addEventListener('click',()=>$('compose-dialog').close());
$('detail-close').addEventListener('click',()=>$('message-dialog').close());
$('profile-open').addEventListener('click',openProfile);
$('profile-close').addEventListener('click',()=>$('profile-dialog').close());
$('compose-maximize').addEventListener('click',()=>{
  const full=$('compose-dialog').classList.toggle('fullscreen-mode');
  $('compose-maximize').innerHTML=`<span class="material-symbols-outlined">${full?'fullscreen_exit':'fullscreen'}</span>`;
});
$('compose-dialog').addEventListener('close',()=>{
  $('compose-dialog').classList.remove('fullscreen-mode');
  $('compose-maximize').innerHTML='<span class="material-symbols-outlined">fullscreen</span>';
});
$('reply-button').addEventListener('click',()=>{
  const message=state.selectedMessage;if (!message) return;
  $('message-dialog').close();
  const subject=/^re:/i.test(message.subject||'')?message.subject:`Re: ${message.subject||''}`;
  openCompose({to:message.from || '',subject});
  const plain=String(message.body||'').replace(/<[^>]*>/g,'');
  $('body').innerHTML=`<br><br><blockquote>On ${escapeHtml(formatDate(message.created_at))}, @${escapeHtml(message.from)} wrote:<br>${escapeHtml(plain).replace(/\n/g,'<br>')}</blockquote>`;
});
document.querySelectorAll('.format-btn').forEach(btn=>btn.addEventListener('click',event=>{
  event.preventDefault();
  const command=btn.dataset.command;
  if (command==='createLink') {
    const input=prompt('Enter an HTTPS or HTTP link:');if (!input) return;
    let url;try {url=new URL(input);} catch {showNotice('Please enter a valid URL.',true);return;}
    if (!['https:','http:'].includes(url.protocol)) {showNotice('Only HTTP or HTTPS links are allowed.',true);return;}
    document.execCommand(command,false,url.href);
  } else document.execCommand(command,false,null);
}));
let draftTimer;
$('body').addEventListener('input',()=>{
  try {localStorage.setItem(userKey('draft'),sanitizeRichText($('body').innerHTML));} catch {showNotice('Draft storage is full.',true);}
  clearTimeout(draftTimer);draftTimer=setTimeout(()=>showNotice('Draft saved'),1000);
});
$('compose-form').addEventListener('submit',async event=>{
  event.preventDefault();$('compose-error').hidden=true;
  const html=sanitizeRichText($('body').innerHTML);
  if (!html.replace(/<[^>]*>/g,'').trim()) {$('compose-error').textContent='Please enter a message.';$('compose-error').hidden=false;return;}
  const send=$('send-button');send.disabled=true;send.innerHTML='<span class="material-symbols-outlined">sync</span> Sending…';
  try {
    const recipient=$('recipient').value.trim().toLowerCase();
    await api('/send',{method:'POST',body:JSON.stringify({to:recipient,subject:$('subject').value.trim(),body:html})});
    addContact(recipient);$('compose-dialog').close();localStorage.removeItem(userKey('draft'));
    await loadFolder('sent');showNotice('Message sent.');
  } catch(error) {$('compose-error').textContent=error.message;$('compose-error').hidden=false;}
  finally {send.disabled=false;send.innerHTML='<span class="material-symbols-outlined">send</span> Send';}
});
$('avatar-upload').addEventListener('change',async event=>{
  const input=event.target,file=input.files?.[0];if (!file) return;
  const label=document.querySelector('.profile-upload-btn');label.style.pointerEvents='none';label.style.opacity='.6';
  try {
    const image=await convertPng(file);
    const data=await api('/profile/avatar',{method:'POST',body:JSON.stringify({image})});
    state.user=data.user;setAvatar($('signed-in-avatar'),state.user);setAvatar($('profile-avatar'),state.user);
    $('avatar-remove').hidden=false;showNotice('Profile photo updated!');
  } catch(error) {showNotice(error.message,true);}
  finally {input.value='';label.style.pointerEvents='';label.style.opacity='';}
});
$('avatar-remove').addEventListener('click',async()=>{
  const button=$('avatar-remove');button.disabled=true;
  try {const data=await api('/profile/avatar',{method:'DELETE'});
    state.user=data.user;setAvatar($('signed-in-avatar'),state.user);setAvatar($('profile-avatar'),state.user);
    button.hidden=true;showNotice('Profile photo removed.');
  } catch(error) {showNotice(error.message,true);} finally {button.disabled=false;}
});
$('theme-toggle').addEventListener('click',()=>applyTheme(document.body.classList.contains('dark')?'light':'dark'));
document.addEventListener('keydown',event=>{
  if (event.key==='Escape') return; // Native dialog Escape behavior is handled by the browser.
  if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
  const target=document.activeElement;
  if (['INPUT','TEXTAREA'].includes(target.tagName) || target.isContentEditable || !$('auth-view').hidden) return;
  if (event.key==='/') {event.preventDefault();if (state.folder!=='friends') $('message-search').focus();}
  if (event.key.toLowerCase()==='c') {event.preventDefault();openCompose();}
});
(async function start(){
  applyTheme(localStorage.getItem(THEME_KEY)||'light');setMode('login');
  if (!token()) {showAuth();return;}
  try {await enterApp();}
  catch(error) {
    if (error.status===401) {expireSession();return;}
    showAuth();$('auth-error').textContent=`Could not reconnect: ${error.message}`;$('auth-error').hidden=false;
    // Keep the token for retry when network connectivity is restored.
  }
})();
