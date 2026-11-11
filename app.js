const API_BASE = "https://friendmail-api.timothy-091.workers.dev/api";
const TOKEN_KEY = "friendmail_session";
const THEME_KEY = "friendmail_theme";
const READ_KEY = "friendmail_read_messages";
const DRAFT_KEY = "friendmail_draft";
const CONTACTS_KEY = "friendmail_contacts";

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

// Contacts (Address Book)
function getContacts() {
  try { return JSON.parse(localStorage.getItem(CONTACTS_KEY)) || []; } 
  catch { return []; }
}
function addContact(username) {
  if (!username) return;
  const contacts = getContacts();
  if (!contacts.includes(username)) {
    contacts.push(username);
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
    renderContacts();
  }
}
function renderContacts() {
  const datalist = $("contacts-list");
  if (datalist) datalist.innerHTML = getContacts().map(c => `<option value="${c}">`).join("");
}

// Read tracking
function getReadMessages() {
  try { return JSON.parse(localStorage.getItem(READ_KEY)) || []; } 
  catch { return []; }
}
function getMessageId(msg) {
  return `${msg.created_at}-${msg.from}-${msg.to}`;
}

// Utilities
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function sanitizeRichText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || "";
  const scripts = div.querySelectorAll('script, iframe, object, embed');
  scripts.forEach(s => s.remove());
  return div.innerHTML;
}
function formatDate(value) { 
  const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; 
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  }
  return date.toLocaleDateString([], { month:"short", day:"numeric" }); 
}
function initials(name) { const clean = String(name || "?").replace(/^@/, ""); return (clean[0] || "?").toUpperCase(); }

// Toast notification
let toastTimeout;
function showNotice(message, isError = false) {
  const el = $("status-message"); 
  el.textContent = message;
  if (isError) {
    el.style.backgroundColor = "var(--sys-error)";
    el.style.color = "#FFF";
  } else {
    el.style.backgroundColor = "var(--pm-purple)";
    el.style.color = "#FFF";
  }
  el.hidden = !message;
  clearTimeout(toastTimeout);
  if (message) toastTimeout = setTimeout(() => el.hidden = true, 4000);
}

// Auth State
function setMode(mode) {
  state.mode = mode; const login = mode === "login";
  $("login-tab").classList.toggle("active", login); 
  $("register-tab").classList.toggle("active", !login);
  $("auth-title").textContent = login ? "Sign in" : "Create your account";
  $("auth-description").textContent = login ? "Continue to your secure inbox" : "Join FriendMail today";
  $("auth-submit").textContent = login ? 'Sign in' : 'Create account';
  $("password").autocomplete = login ? "current-password" : "new-password";
  $("password-help").hidden = login; $("auth-error").hidden = true;
}

function showAuth() { $("auth-view").hidden = false; $("mail-view").hidden = true; }
function showMail() {
  $("auth-view").hidden = true; $("mail-view").hidden = false;
  $("signed-in-as").textContent = `@${state.user.username}`;
  $("signed-in-avatar").textContent = initials(state.user.username);
  renderContacts();
}

function updateSearch() {
  const query = $("message-search").value.trim().toLowerCase();
  state.filteredMessages = state.messages.filter(m => [m.from,m.to,m.subject,m.body,m.preview].some(value => String(value || "").toLowerCase().includes(query)));
  renderMessages();
}

// New: Generate Skeleton UI for loading state
function renderSkeletons() {
  const skeletons = Array(6).fill(`<div class="skeleton-row">
    <div class="skeleton-box" style="width: 24px; border-radius: 50%;"></div>
    <div class="skeleton-box" style="width: 150px;"></div>
    <div class="skeleton-box" style="flex: 1;"></div>
    <div class="skeleton-box" style="width: 80px;"></div>
  </div>`).join("");
  $("message-list").innerHTML = skeletons;
}

async function loadFolder(folder = state.folder) {
  state.folder = folder;
  document.querySelectorAll(".folder").forEach(button => button.classList.toggle("active", button.dataset.folder === folder));
  $("message-search").value = "";
  renderSkeletons(); // Call front-end feature during load
  
  try {
    const data = await api(folder === "inbox" ? "/inbox" : "/sent");
    state.messages = data.messages || [];
    if (folder === "inbox") {
      const readList = getReadMessages();
      const unreadCount = state.messages.filter(m => !readList.includes(getMessageId(m))).length;
      $("inbox-count").textContent = unreadCount > 0 ? unreadCount : "";
    } else {
      $("inbox-count").textContent = ""; // clear if not inbox
    }
    updateSearch();
  } catch (error) {
    if (/token|authorization/i.test(error.message)) { 
      setToken(null); 
      showAuth(); 
      $("auth-error").textContent = "Session expired. Please log in again."; 
      $("auth-error").hidden = false;
    } else { 
      $("message-list").innerHTML = `<div class="empty-state">Failed to load: ${error.message}</div>`; 
      showNotice(error.message, true); 
    }
  }
}

function renderMessages() {
  const list = $("message-list"), messages = state.filteredMessages;
  $("message-total").textContent = messages.length > 0 ? `1-${messages.length} of ${messages.length}` : "";
  
  if (!messages.length) {
    list.innerHTML = `<div class="empty-state">No messages found.</div>`;
    return;
  }
  
  const readList = getReadMessages();
  
  list.innerHTML = messages.map((m, index) => {
    if (m.from) addContact(m.from);
    if (m.to) addContact(m.to);

    const person = state.folder === "inbox" ? m.from : `To: ${m.to}`;
    const rawPreviewText = String(m.preview || m.body || "").replace(/<[^>]*>?/gm, '');
    const preview = rawPreviewText.replace(/\s+/g," ").substring(0, 80);
    
    const isUnread = state.folder === "inbox" && !readList.includes(getMessageId(m));
    const unreadClass = isUnread ? "unread" : "";
    
    // Grid structured row with Quick Actions (UI only feature)
    return `<div class="message-row ${unreadClass}" data-index="${index}">
      <div class="msg-icons">
        <span class="material-symbols-outlined" style="font-size: 20px;">${isUnread ? "" : "mail"}</span>
      </div>
      <div class="msg-sender">${escapeHtml(person)}</div>
      <div class="msg-content">
        <span class="msg-subject">${escapeHtml(m.subject || "(No subject)")}</span>
        <span class="msg-snippet"> - ${escapeHtml(preview)}</span>
      </div>
      <div class="msg-date">${escapeHtml(formatDate(m.created_at))}</div>
      <div class="msg-actions">
        <button class="icon-btn small action-del" title="Delete (Local)" data-index="${index}"><span class="material-symbols-outlined">delete</span></button>
      </div>
    </div>`;
  }).join("");
  
  // Attach Event Listeners to rows
  list.querySelectorAll(".message-row").forEach(row => {
    row.addEventListener("click", (e) => {
      // Prevent opening message if clicking a quick action button
      if (e.target.closest('.action-del')) {
        row.style.display = 'none'; // UI-only delete feature
        showNotice("Message moved to trash");
        return;
      }
      openMessage(messages[Number(row.dataset.index)]);
    });
  });
}

function openMessage(message) {
  state.selectedMessage = message;
  
  if (state.folder === "inbox") {
    const msgId = getMessageId(message);
    const readList = getReadMessages();
    if (!readList.includes(msgId)) {
      readList.push(msgId);
      localStorage.setItem(READ_KEY, JSON.stringify(readList));
      // Update unread count dynamically
      const unreadCount = state.messages.filter(m => !readList.includes(getMessageId(m))).length;
      $("inbox-count").textContent = unreadCount > 0 ? unreadCount : "";
      renderMessages();
    }
  }

  $("detail-meta").textContent = formatDate(message.created_at);
  $("detail-subject").textContent = message.subject || "(No subject)";
  
  const person = state.folder === "inbox" ? message.from : message.to;
  $("detail-from").innerHTML = `${escapeHtml(person)} <span style="color:var(--sys-on-surface-variant); font-weight:normal;">&lt;${escapeHtml(person)}@friendmail.local&gt;</span>`;
  $("detail-avatar").textContent = initials(person);
  
  $("detail-body").innerHTML = sanitizeRichText(message.body);
  $("reply-button").hidden = state.folder !== "inbox";
  $("message-dialog").showModal();
}

async function enterApp() { const data = await api("/me"); state.user = data.user; showMail(); await loadFolder("inbox"); }

let draftTimer;
function openCompose({to="",subject=""}={}) {
  $("compose-error").hidden = true; $("compose-form").reset();
  $("recipient").value = to; $("subject").value = subject;
  
  if (!to && !subject) {
    $("body").innerHTML = localStorage.getItem(DRAFT_KEY) || "";
  } else {
    $("body").innerHTML = "";
  }
  
  $("compose-dialog").show();
  setTimeout(() => $("recipient").focus(), 50);
}

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  $("theme-toggle").innerHTML = theme === "dark" ? '<span class="material-symbols-outlined">light_mode</span>' : '<span class="material-symbols-outlined">dark_mode</span>';
  localStorage.setItem(THEME_KEY, theme);
}

// Sidebar Toggle Feature (UI Only)
const sidebarToggleBtn = $("sidebar-toggle");
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener("click", () => {
    $("app-sidebar").classList.toggle("collapsed");
  });
}

// Event Listeners
$("login-tab").addEventListener("click", () => setMode("login"));
$("register-tab").addEventListener("click", () => setMode("register"));

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault(); $("auth-error").hidden = true;
  const username = $("username").value.trim(), password = $("password").value;
  const submit = $("auth-submit"); submit.disabled = true; submit.textContent = "Authenticating...";
  try {
    const data = await api(state.mode === "login" ? "/login" : "/register", {method:"POST",body:JSON.stringify({username,password})});
    setToken(data.token); state.user = data.user; $("password").value = ""; showMail(); await loadFolder("inbox");
  } catch(error) { $("auth-error").textContent = error.message; $("auth-error").hidden = false; }
  finally { submit.disabled = false; submit.textContent = state.mode === "login" ? 'Sign in' : 'Create account'; }
});

$("logout-button").addEventListener("click", () => { setToken(null); state.user = null; state.messages = []; state.filteredMessages = []; showAuth(); setMode("login"); });
document.querySelectorAll(".folder").forEach(button => button.addEventListener("click", () => loadFolder(button.dataset.folder)));
$("refresh-button").addEventListener("click", () => loadFolder());
$("message-search").addEventListener("input", updateSearch);

$("compose-open").addEventListener("click", () => openCompose());
$("compose-close").addEventListener("click", () => $("compose-dialog").close());
$("detail-close").addEventListener("click", () => $("message-dialog").close());

// FULLSCREEN TOGGLE
const maximizeBtn = $("compose-maximize");
if (maximizeBtn) {
  maximizeBtn.addEventListener("click", () => {
    const dialog = $("compose-dialog");
    const isFullscreen = dialog.classList.toggle("fullscreen-mode");
    maximizeBtn.innerHTML = isFullscreen 
      ? '<span class="material-symbols-outlined">fullscreen_exit</span>' 
      : '<span class="material-symbols-outlined">fullscreen</span>';
  });
}

$("reply-button").addEventListener("click", () => {
  const message = state.selectedMessage; if (!message) return;
  $("message-dialog").close();
  const subject = String(message.subject || "").toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject || ""}`;
  const plainText = String(message.body || "").replace(/<[^>]*>?/gm, '');
  const quote = `<br><br><blockquote>On ${formatDate(message.created_at)}, ${message.from} wrote:<br>${plainText}</blockquote>`;
  
  openCompose({to:message.from || "",subject});
  $("body").innerHTML = quote;
});

// Rich Text
document.querySelectorAll(".format-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.preventDefault(); 
    const command = btn.dataset.command;
    if (command === 'createLink') {
      const url = prompt('Enter link URL:');
      if (url) document.execCommand(command, false, url);
    } else {
      document.execCommand(command, false, null);
    }
  });
});

$("body").addEventListener("input", (e) => {
  localStorage.setItem(DRAFT_KEY, e.target.innerHTML);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => showNotice("Draft saved"), 1000);
});

$("compose-form").addEventListener("submit", async event => {
  event.preventDefault(); $("compose-error").hidden = true;
  const htmlBody = $("body").innerHTML.trim();
  if (!htmlBody || htmlBody === "<br>") {
    $("compose-error").textContent = "Please enter a message.";
    $("compose-error").hidden = false;
    return;
  }
  
  const recipient = $("recipient").value.trim();
  const send = $("send-button"); send.disabled = true; send.innerHTML = '<span class="material-symbols-outlined">sync</span> Sending...';
  
  try {
    await api("/send", {method:"POST",body:JSON.stringify({
      to: recipient,
      subject: $("subject").value.trim(),
      body: htmlBody
    })});
    
    addContact(recipient);
    $("compose-dialog").close();
    localStorage.removeItem(DRAFT_KEY); 
    await loadFolder("sent"); showNotice("Message sent.");
  } catch(error) { $("compose-error").textContent = error.message; $("compose-error").hidden = false; }
  finally { send.disabled = false; send.innerHTML = '<span class="material-symbols-outlined">send</span> Send'; }
});

$("theme-toggle").addEventListener("click", () => applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));

// Shortcuts
document.addEventListener("keydown", event => {
  const activeElement = document.activeElement;
  const inInput = ["INPUT", "TEXTAREA"].includes(activeElement.tagName) || activeElement.id === "body";
  
  if (event.key === "Escape") {
    if ($("compose-dialog").hasAttribute("open")) {
      $("compose-dialog").close();
      if ($("compose-dialog").classList.contains("fullscreen-mode") && maximizeBtn) maximizeBtn.click();
    }
    if ($("message-dialog").hasAttribute("open")) $("message-dialog").close();
    return;
  }
  
  if (inInput || $("auth-view").hidden === false) return;

  switch(event.key.toLowerCase()) {
    case "/": event.preventDefault(); $("message-search").focus(); break;
    case "c": event.preventDefault(); openCompose(); break;
    case "r": if ($("message-dialog").hasAttribute("open")) { event.preventDefault(); $("reply-button").click(); } break;
  }
});

(async function start() {
  applyTheme(localStorage.getItem(THEME_KEY) || "light"); setMode("login");
  if (!API_BASE.startsWith("https://") || API_BASE.includes("YOUR-WORKER-NAME")) {
    showAuth(); $("auth-error").textContent = "API URL not configured."; $("auth-error").hidden = false; return;
  }
  if (token()) { try { await enterApp(); } catch { setToken(null); showAuth(); } } else showAuth();
})();
