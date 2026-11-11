const API_BASE = "https://friendmail-api.timothy-091.workers.dev/api";
const TOKEN_KEY = "friendmail_session";
const THEME_KEY = "friendmail_theme";
const READ_KEY = "friendmail_read_messages";
const DRAFT_KEY = "friendmail_draft";
const $ = (id) => document.getElementById(id);
const state = { mode: "login", folder: "inbox", messages: [], filteredMessages: [], user: null, selectedMessage: null };

function token() { return localStorage.getItem(TOKEN_KEY); }
function setToken(value) { if (value) localStorage.setItem(TOKEN_KEY, value); else localStorage.removeItem(TOKEN_KEY); }
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// Get array of read message IDs from local storage
function getReadMessages() {
  try { return JSON.parse(localStorage.getItem(READ_KEY)) || []; } 
  catch { return []; }
}

// Generate a unique ID for a message since the API doesn't provide one
function getMessageId(msg) {
  return `${msg.created_at}-${msg.from}-${msg.to}`;
}

// Auto-link URLs in message body
function linkify(text) {
  const safeText = escapeHtml(text || "");
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return safeText.replace(urlRegex, '<a href="$1" target="_blank" class="msg-link">$1</a>');
}

// Toast notification
let toastTimeout;
function showNotice(message, isError = false) {
  const el = $("status-message"); 
  el.textContent = message;
  el.style.backgroundColor = isError ? "var(--sys-error)" : "#323232";
  el.hidden = !message;
  clearTimeout(toastTimeout);
  if (message) toastTimeout = setTimeout(() => el.hidden = true, 4000);
}

function setMode(mode) {
  state.mode = mode; const login = mode === "login";
  $("login-tab").classList.toggle("active", login); 
  $("register-tab").classList.toggle("active", !login);
  $("auth-title").textContent = login ? "Welcome back" : "Create your account";
  $("auth-description").textContent = login ? "Sign in to continue" : "Join FriendMail today";
  $("auth-submit").textContent = login ? 'Sign In' : 'Create Account';
  $("password").autocomplete = login ? "current-password" : "new-password";
  $("password-help").hidden = login; $("auth-error").hidden = true;
}

function showAuth() { $("auth-view").hidden = false; $("mail-view").hidden = true; }
function showMail() {
  $("auth-view").hidden = true; $("mail-view").hidden = false;
  $("signed-in-as").textContent = `@${state.user.username}`;
  $("signed-in-avatar").textContent = initials(state.user.username);
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function formatDate(value) { 
  const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; 
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  }
  return date.toLocaleDateString([], { month:"short", day:"numeric" }); 
}
function initials(name) { const clean = String(name || "?").replace(/^@/, ""); return (clean[0] || "?").toUpperCase(); }

function updateSearch() {
  const query = $("message-search").value.trim().toLowerCase();
  state.filteredMessages = state.messages.filter(m => [m.from,m.to,m.subject,m.body,m.preview].some(value => String(value || "").toLowerCase().includes(query)));
  renderMessages();
}

async function loadFolder(folder = state.folder) {
  state.folder = folder;
  document.querySelectorAll(".folder").forEach(button => button.classList.toggle("active", button.dataset.folder === folder));
  $("message-search").value = "";
  $("message-list").innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const data = await api(folder === "inbox" ? "/inbox" : "/sent");
    state.messages = data.messages || [];
    if (folder === "inbox") {
      $("inbox-count").textContent = state.messages.length ? state.messages.length : "";
    }
    updateSearch();
  } catch (error) {
    if (/token|authorization/i.test(error.message)) { setToken(null); showAuth(); }
    else { $("message-list").innerHTML = `<div class="empty-state">Failed to load: ${error.message}</div>`; showNotice(error.message, true); }
  }
}

function renderMessages() {
  const list = $("message-list"), messages = state.filteredMessages;
  $("message-total").textContent = messages.length > 0 ? `1-${messages.length} of ${messages.length}` : "";
  
  if (!messages.length) {
    list.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined" style="font-size:48px; opacity:0.5; margin-bottom:16px; display:block;">inventory_2</span><strong>Nothing to see here</strong></div>`;
    return;
  }
  
  const readList = getReadMessages();
  
  list.innerHTML = messages.map((m, index) => {
    const person = state.folder === "inbox" ? m.from : `To: ${m.to}`;
    const preview = String(m.preview || m.body || "").replace(/\s+/g," ");
    const isUnread = state.folder === "inbox" && !readList.includes(getMessageId(m));
    const unreadClass = isUnread ? "unread" : "";
    
    return `<div class="message-row ${unreadClass}" data-index="${index}">
      <div class="msg-icons">
        <span class="material-symbols-outlined" style="font-size: 20px;">check_box_outline_blank</span>
        <span class="material-symbols-outlined" style="font-size: 20px;">${isUnread ? "mark_email_unread" : "star_border"}</span>
      </div>
      <div class="msg-sender">${escapeHtml(person)}</div>
      <div class="msg-content">
        <span class="msg-subject">${escapeHtml(m.subject || "(No subject)")}</span>
        <span class="msg-snippet"> - ${escapeHtml(preview)}</span>
      </div>
      <div class="msg-date">${escapeHtml(formatDate(m.created_at))}</div>
    </div>`;
  }).join("");
  
  list.querySelectorAll(".message-row").forEach(row => row.addEventListener("click", () => openMessage(messages[Number(row.dataset.index)])));
}

function openMessage(message) {
  state.selectedMessage = message;
  
  // Mark as read
  if (state.folder === "inbox") {
    const msgId = getMessageId(message);
    const readList = getReadMessages();
    if (!readList.includes(msgId)) {
      readList.push(msgId);
      localStorage.setItem(READ_KEY, JSON.stringify(readList));
      renderMessages(); // Re-render to remove bold styling
    }
  }

  $("detail-meta").textContent = formatDate(message.created_at);
  $("detail-subject").textContent = message.subject || "(No subject)";
  
  const person = state.folder === "inbox" ? message.from : message.to;
  $("detail-from").innerHTML = `<strong>${escapeHtml(person)}</strong> <span style="color:var(--sys-on-surface-variant); font-size:12px;">&lt;${escapeHtml(person)}@friendmail.local&gt;</span>`;
  $("detail-avatar").textContent = initials(person);
  
  // Apply smart links
  $("detail-body").innerHTML = linkify(message.body);
  $("reply-button").hidden = state.folder !== "inbox";
  $("message-dialog").showModal();
}

async function enterApp() { const data = await api("/me"); state.user = data.user; showMail(); await loadFolder("inbox"); }

let draftTimer;

function openCompose({to="",subject=""}={}) {
  $("compose-error").textContent = ""; $("compose-form").reset();
  $("recipient").value = to; $("subject").value = subject;
  
  // Load draft if it's a blank new message
  if (!to && !subject) {
    $("body").value = localStorage.getItem(DRAFT_KEY) || "";
  }
  
  $("compose-dialog").show();
  setTimeout(() => $("recipient").focus(), 50);
}

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  $("theme-toggle").innerHTML = theme === "dark" ? '<span class="material-symbols-outlined">light_mode</span>' : '<span class="material-symbols-outlined">dark_mode</span>';
  localStorage.setItem(THEME_KEY, theme);
}

// Event Listeners
$("login-tab").addEventListener("click", () => setMode("login"));
$("register-tab").addEventListener("click", () => setMode("register"));

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault(); $("auth-error").hidden = true;
  const username = $("username").value.trim(), password = $("password").value;
  const submit = $("auth-submit"); submit.disabled = true; submit.textContent = "Please wait...";
  try {
    const data = await api(state.mode === "login" ? "/login" : "/register", {method:"POST",body:JSON.stringify({username,password})});
    setToken(data.token); state.user = data.user; $("password").value = ""; showMail(); await loadFolder("inbox");
  } catch(error) { $("auth-error").textContent = error.message; $("auth-error").hidden = false; }
  finally { submit.disabled = false; submit.textContent = state.mode === "login" ? 'Sign In' : 'Create Account'; }
});

$("logout-button").addEventListener("click", () => { setToken(null); state.user = null; state.messages = []; state.filteredMessages = []; showAuth(); setMode("login"); });
document.querySelectorAll(".folder").forEach(button => button.addEventListener("click", () => loadFolder(button.dataset.folder)));
$("refresh-button").addEventListener("click", () => loadFolder());
$("message-search").addEventListener("input", updateSearch);

$("compose-open").addEventListener("click", () => openCompose());
$("compose-close").addEventListener("click", () => {
    $("compose-dialog").close();
    $("compose-dialog").style.display = "none";
});
$("detail-close").addEventListener("click", () => $("message-dialog").close());

$("reply-button").addEventListener("click", () => {
  const message = state.selectedMessage; if (!message) return;
  $("message-dialog").close();
  const subject = String(message.subject || "").toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject || ""}`;
  openCompose({to:message.from || "",subject});
});

// Save draft as you type
$("body").addEventListener("input", (e) => {
  localStorage.setItem(DRAFT_KEY, e.target.value);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => showNotice("Draft saved to browser"), 1000);
});

$("compose-form").addEventListener("submit", async event => {
  event.preventDefault(); $("compose-error").textContent = "";
  const send = $("send-button"); send.disabled = true; send.textContent = "Sending...";
  try {
    await api("/send", {method:"POST",body:JSON.stringify({to:$("recipient").value.trim(),subject:$("subject").value.trim(),body:$("body").value})});
    $("compose-dialog").close();
    $("compose-dialog").style.display = "none";
    localStorage.removeItem(DRAFT_KEY); // Clear the draft!
    await loadFolder("sent"); showNotice("Message sent.");
  } catch(error) { $("compose-error").textContent = error.message; }
  finally { send.disabled = false; send.textContent = 'Send'; }
});

$("theme-toggle").addEventListener("click", () => applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));

// Keyboard Shortcuts
document.addEventListener("keydown", event => {
  const activeTag = document.activeElement.tagName;
  const inInput = ["INPUT", "TEXTAREA"].includes(activeTag);
  
  // Escape always closes dialogs
  if (event.key === "Escape") {
    if ($("compose-dialog").hasAttribute("open")) {
        $("compose-dialog").close();
        $("compose-dialog").style.display = "none";
    }
    if ($("message-dialog").hasAttribute("open")) $("message-dialog").close();
    return;
  }
  
  // Don't trigger other shortcuts if typing in a field
  if (inInput || $("auth-view").hidden === false) return;

  switch(event.key.toLowerCase()) {
    case "/": 
      event.preventDefault(); 
      $("message-search").focus(); 
      break;
    case "c": 
      event.preventDefault(); 
      openCompose(); 
      break;
    case "r": 
      if ($("message-dialog").hasAttribute("open")) {
        event.preventDefault();
        $("reply-button").click();
      }
      break;
  }
});

(async function start() {
  applyTheme(localStorage.getItem(THEME_KEY) || "light"); setMode("login");
  if (!API_BASE.startsWith("https://") || API_BASE.includes("YOUR-WORKER-NAME")) {
    showAuth(); $("auth-error").textContent = "API URL not configured."; $("auth-error").hidden = false; return;
  }
  if (token()) { try { await enterApp(); } catch { setToken(null); showAuth(); } } else showAuth();
})();
