// FriendMail API — Cloudflare Workers + D1. No secrets are bundled into GitHub Pages.
const encoder = new TextEncoder();
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_AVATAR_BYTES = 140 * 1024;
const USERNAME = /^[a-z0-9_]{3,24}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const toB64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
const usernameOf = value => String(value ?? '').trim().toLowerCase();
const now = () => new Date().toISOString();
const fail = (status, message) => { throw new HttpError(status, message); };

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:fromB64(salt), iterations:210000}, key, 256);
  return toB64(new Uint8Array(bytes));
}
function secureEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || 'http://localhost:8000,http://127.0.0.1:8000').split(',').map(s=>s.trim());
  const isAllowed = origin && allowed.includes(origin);
  return {allowed: !origin || Boolean(isAllowed), headers: {
    ...(isAllowed ? {'Access-Control-Allow-Origin':origin} : {}),
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
    'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin',
    'X-Content-Type-Options':'nosniff',
    'Cache-Control':'no-store'
  }};
}
function json(value, status=200, headers={}) {
  return new Response(JSON.stringify(value), {status, headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
}
async function bodyJson(request, max=400000) {
  if (Number(request.headers.get('Content-Length') || 0) > max) fail(413,'Request too large.');
  const str = await request.text();
  if (str.length > max) fail(413,'Request too large.');
  let data;
  try { data = JSON.parse(str); } catch { fail(400,'Invalid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400,'Expected a JSON object.');
  return data;
}
async function sessionFor(db, request) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header);
  if (!match) fail(401,'Please sign in again.');
  const digest = await sha256(match[1]);
  const user = await db.prepare(`SELECT users.id, users.username, users.avatar_version
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).bind(digest, Date.now()).first();
  if (!user) fail(401,'Session expired. Please sign in again.');
  return { ...user, digest };
}
function publicUser(user) {return {username:user.username, avatar_version:user.avatar_version || 0};}
async function issueSession(db, user) {
  const token = toB64(randomBytes(32)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .bind(await sha256(token), user.id, Date.now() + SESSION_SECONDS * 1000).run();
  return {token, user:publicUser(user)};
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) fail(400,'Password must be 10–128 characters.');
}
async function accounts(db, request, operation) {
  const {username:raw, password} = await bodyJson(request, 10000);
  const username = usernameOf(raw);
  if (!USERNAME.test(username)) fail(400,'Username must be 3–24 letters, numbers, or underscores.');
  if (operation === 'register') {
    validatePassword(password);
    if (await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first()) fail(409,'That username is already taken.');
    const salt = toB64(randomBytes(16));
    const hash = await passwordHash(password, salt);
    try {
      await db.prepare('INSERT INTO users(username,password_hash,salt) VALUES(?,?,?)').bind(username,hash,salt).run();
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error))) fail(409,'That username is already taken.');
      throw error;
    }
  }
  const found = await db.prepare('SELECT id,username,password_hash,salt,avatar_version FROM users WHERE username=?').bind(username).first();
  // Use a real KDF even for unknown usernames to reduce username enumeration from login timing.
  const dummySalt = 'AAECAwQFBgcICQoLDA0ODw==';
  const hash = await passwordHash(typeof password === 'string' ? password : '', found?.salt || dummySalt);
  if (!found || !secureEqual(hash, found.password_hash)) fail(401,'Invalid username or password.');
  return issueSession(db, found);
}

async function listMessages(db, user, folder) {
  const incoming = folder === 'inbox';
  const {results} = await db.prepare(`SELECT m.id,m.subject,m.body,m.created_at,
    s.username AS "from", r.username AS "to", s.avatar_version AS sender_avatar_version,
    r.avatar_version AS recipient_avatar_version
    FROM messages m JOIN users s ON m.sender_id=s.id JOIN users r ON m.recipient_id=r.id
    WHERE ${incoming ? 'm.recipient_id=? AND m.recipient_deleted=0' : 'm.sender_id=? AND m.sender_deleted=0'}
    ORDER BY m.id DESC LIMIT 300`).bind(user.id).all();
  return {messages:results.map(m=>({...m,preview:String(m.body).replace(/<[^>]*>/g,'').slice(0,140)}))};
}
async function sendMessage(db, user, request) {
  const data = await bodyJson(request, 70000);
  const recipient = usernameOf(data.to);
  if (!USERNAME.test(recipient)) fail(400,'Enter a valid recipient username.');
  if (typeof data.subject !== 'string' || data.subject.length > 200) fail(400,'Subject is too long.');
  if (typeof data.body !== 'string' || !data.body.trim() || data.body.length > 30000) fail(400,'Message must be 1–30,000 characters.');
  const target = await db.prepare('SELECT id FROM users WHERE username=?').bind(recipient).first();
  if (!target) fail(404,'Recipient not found.');
  await db.prepare('INSERT INTO messages(sender_id,recipient_id,subject,body) VALUES(?,?,?,?)')
    .bind(user.id,target.id,data.subject,data.body).run();
  return {ok:true};
}
async function deleteMessage(db, user, id) {
  if (!/^\d+$/.test(id)) fail(400,'Invalid message.');
  await db.prepare(`UPDATE messages SET sender_deleted=CASE WHEN sender_id=? THEN 1 ELSE sender_deleted END,
    recipient_deleted=CASE WHEN recipient_id=? THEN 1 ELSE recipient_deleted END
    WHERE id=? AND (sender_id=? OR recipient_id=?)`).bind(user.id,user.id,Number(id),user.id,user.id).run();
  return {ok:true};
}

async function friendsOverview(db, user) {
  const friends = await db.prepare(`SELECT u.username,u.avatar_version FROM friends f
    JOIN users u ON u.id=CASE WHEN f.user1_id=? THEN f.user2_id ELSE f.user1_id END
    WHERE f.user1_id=? OR f.user2_id=? ORDER BY u.username`).bind(user.id,user.id,user.id).all();
  const incoming = await db.prepare(`SELECT r.id,u.username,u.avatar_version,r.created_at
    FROM friend_requests r JOIN users u ON u.id=r.sender_id
    WHERE r.receiver_id=? AND r.status='pending' ORDER BY r.created_at DESC`).bind(user.id).all();
  const outgoing = await db.prepare(`SELECT r.id,u.username,u.avatar_version,r.created_at
    FROM friend_requests r JOIN users u ON u.id=r.receiver_id
    WHERE r.sender_id=? AND r.status='pending' ORDER BY r.created_at DESC`).bind(user.id).all();
  const suggestions = await db.prepare(`SELECT u.username,u.avatar_version FROM users u WHERE u.id<>?
    AND NOT EXISTS(SELECT 1 FROM friends f WHERE (f.user1_id=? AND f.user2_id=u.id) OR (f.user2_id=? AND f.user1_id=u.id))
    AND NOT EXISTS(SELECT 1 FROM friend_requests r WHERE r.status='pending'
      AND ((r.sender_id=? AND r.receiver_id=u.id) OR (r.receiver_id=? AND r.sender_id=u.id)))
    ORDER BY RANDOM() LIMIT 5`).bind(user.id,user.id,user.id,user.id,user.id).all();
  return {friends:friends.results,incoming:incoming.results,outgoing:outgoing.results,suggestions:suggestions.results};
}
async function requestFriend(db, user, request) {
  const {username:raw} = await bodyJson(request, 5000);
  const targetName = usernameOf(raw);
  if (!USERNAME.test(targetName)) fail(400,'Enter a valid username.');
  const target = await db.prepare('SELECT id FROM users WHERE username=?').bind(targetName).first();
  if (!target) fail(404,'User not found.');
  if (target.id === user.id) fail(400,'You cannot add yourself.');
  const a = Math.min(user.id,target.id), b = Math.max(user.id,target.id);
  if (await db.prepare('SELECT 1 FROM friends WHERE user1_id=? AND user2_id=?').bind(a,b).first()) fail(409,'You are already friends.');
  const inbound = await db.prepare("SELECT id FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status='pending'").bind(target.id,user.id).first();
  if (inbound) fail(409,'This person sent you a request. Accept it under Incoming requests.');
  const outbound = await db.prepare("SELECT id FROM friend_requests WHERE sender_id=? AND receiver_id=? AND status='pending'").bind(user.id,target.id).first();
  if (outbound) fail(409,'Friend request already sent.');
  try {
    await db.prepare("INSERT INTO friend_requests(sender_id,receiver_id,status) VALUES(?,?,'pending')")
      .bind(user.id,target.id).run();
  } catch (error) {
    if (/UNIQUE constraint/i.test(String(error))) fail(409,'Friend request already pending.');
    throw error;
  }
  return {ok:true};
}
async function actionRequest(db, user, id, request) {
  if (!/^\d+$/.test(id)) fail(400,'Invalid request.');
  const {action} = await bodyJson(request,5000);
  if (!['accept','decline','cancel'].includes(action)) fail(400,'Invalid action.');
  const entry = await db.prepare('SELECT * FROM friend_requests WHERE id=? AND status=\'pending\'').bind(Number(id)).first();
  if (!entry) fail(404,'Request not found or already handled.');
  if (action === 'cancel' && entry.sender_id !== user.id) fail(403,'You cannot cancel this request.');
  if (action !== 'cancel' && entry.receiver_id !== user.id) fail(403,'Only the recipient can respond.');
  const result = await db.prepare("UPDATE friend_requests SET status=?, responded_at=? WHERE id=? AND status='pending'")
    .bind(action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled',now(),entry.id).run();
  if (!result.meta?.changes) fail(409,'Request was already handled.');
  if (action === 'accept') {
    await db.prepare('INSERT OR IGNORE INTO friends(user1_id,user2_id) VALUES(?,?)')
      .bind(Math.min(entry.sender_id,entry.receiver_id),Math.max(entry.sender_id,entry.receiver_id)).run();
    // If both people invited each other concurrently, clear the reciprocal pending invite.
    await db.prepare("UPDATE friend_requests SET status='cancelled',responded_at=? WHERE sender_id=? AND receiver_id=? AND status='pending'")
      .bind(now(),entry.receiver_id,entry.sender_id).run();
  }
  return {ok:true};
}
async function removeFriend(db, user, name) {
  const target = await db.prepare('SELECT id FROM users WHERE username=?').bind(usernameOf(name)).first();
  if (!target) fail(404,'User not found.');
  const result = await db.prepare('DELETE FROM friends WHERE user1_id=? AND user2_id=?')
    .bind(Math.min(user.id,target.id),Math.max(user.id,target.id)).run();
  if (!result.meta?.changes) fail(404,'Friend not found.');
  return {ok:true};
}
function verifyPng(bytes) {
  const magic = [137,80,78,71,13,10,26,10];
  if (bytes.length < 33 || bytes.length > MAX_AVATAR_BYTES || !magic.every((v,i)=>bytes[i]===v)) return false;
  // PNG first chunk must be IHDR, dimensions 1–512 px.
  if (String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') return false;
  const read32 = start => new DataView(bytes.buffer,bytes.byteOffset+start,4).getUint32(0);
  return read32(8) === 13 && read32(16)>0 && read32(16)<=512 && read32(20)>0 && read32(20)<=512;
}
async function uploadAvatar(db, user, request) {
  const {image} = await bodyJson(request, 240000);
  if (typeof image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) fail(400,'Upload a PNG image.');
  const base64 = image.slice('data:image/png;base64,'.length);
  let bytes;
  try { bytes = fromB64(base64); } catch { fail(400,'Invalid PNG image.'); }
  if (!verifyPng(bytes)) fail(400,'Invalid PNG or image exceeds 140 KB / 512 pixels.');
  const version = Date.now();
  await db.prepare('UPDATE users SET avatar=?,avatar_version=? WHERE id=?').bind(base64,version,user.id).run();
  return {user:{username:user.username,avatar_version:version}};
}
async function avatarImage(db, username) {
  const user = await db.prepare('SELECT avatar FROM users WHERE username=?').bind(usernameOf(username)).first();
  if (!user?.avatar) fail(404,'Avatar not found.');
  const image = fromB64(user.avatar);
  return new Response(image, {headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
}

async function route(request, env, path) {
  if (!env.DB) fail(503,'Database is not configured. Deploy the D1 binding first.');
  const db = env.DB, method = request.method;
  if (method === 'GET' && path === '/health') {
    await db.prepare('SELECT 1 AS ok').first();
    return {status:'ok'};
  }
  if (method === 'POST' && (path==='/login' || path==='/register')) return accounts(db,request,path.slice(1));
  const avatarRoute = /^\/avatars\/([a-zA-Z0-9_]{3,24})$/.exec(path);
  if (method === 'GET' && avatarRoute) return avatarImage(db,avatarRoute[1]);
  const user = await sessionFor(db,request);
  if (method === 'GET' && path === '/me') return {user:publicUser(user)};
  if (method === 'POST' && path === '/logout') {
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.digest).run();
    return {ok:true};
  }
  if (method === 'GET' && (path === '/inbox' || path === '/sent')) return listMessages(db,user,path.slice(1));
  if (method === 'POST' && path === '/send') return sendMessage(db,user,request);
  const messageDelete = /^\/messages\/(\d+)$/.exec(path);
  if (method === 'DELETE' && messageDelete) return deleteMessage(db,user,messageDelete[1]);
  if (method === 'GET' && path === '/friends/overview') return friendsOverview(db,user);
  if (method === 'POST' && path === '/friends/requests') return requestFriend(db,user,request);
  const requestAction = /^\/friends\/requests\/(\d+)$/.exec(path);
  if (method === 'POST' && requestAction) return actionRequest(db,user,requestAction[1],request);
  const friendDelete = /^\/friends\/([a-zA-Z0-9_]{3,24})$/.exec(path);
  if (method === 'DELETE' && friendDelete) return removeFriend(db,user,friendDelete[1]);
  if (method === 'POST' && path === '/profile/avatar') return uploadAvatar(db,user,request);
  if (method === 'DELETE' && path === '/profile/avatar') {
    await db.prepare('UPDATE users SET avatar=NULL,avatar_version=0 WHERE id=?').bind(user.id).run();
    return {user:{username:user.username,avatar_version:0}};
  }
  fail(404,'Endpoint not found. Check that the latest FriendMail Worker is deployed.');
}

export default {
  async fetch(request, env) {
    const {allowed,headers} = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null,{status:allowed?204:403,headers});
    if (!allowed) return json({error:'Origin not allowed. Add your website URL to ALLOWED_ORIGINS.'},403,headers);
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/api/')) return json({error:'Not found'},404,headers);
    try {
      const output = await route(request,env,pathname.slice(4));
      if (output instanceof Response) {
        const merged = new Headers(output.headers);
        for (const [k,v] of Object.entries(headers)) if (k!=='Cache-Control') merged.set(k,v);
        return new Response(output.body,{status:output.status,headers:merged});
      }
      return json(output,200,headers);
    } catch(error) {
      if (!(error instanceof HttpError)) console.error('FriendMail API error',error);
      return json({error:error instanceof HttpError?error.message:'Server error. Check the Worker logs and D1 migrations.'},error instanceof HttpError?error.status:500,headers);
    }
  }
};
