// FriendMail frontend. API endpoints and request formats remain unchanged.
const API_BASE = "https://friendmail-api.timothy-091.workers.dev/api";
const TOKEN_KEY = "friendmail_session";
const THEME_KEY = "friendmail_theme";
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
function showNotice(message, isError = false) {
  const el = $("status-message"); el.textContent = message;
  el.className = isError ? "notice error" : "notice"; el.hidden = !message;
}
function setMode(mode) {
  state.mode = mode; const login = mode === "login";
  $("login-tab").classList.toggle("active", login); $("register-tab").classList.toggle("active", !login);
  $("login-tab").setAttribute("aria-selected", String(login)); $("register-tab").setAttribute("aria-selected", String(!login));
  $("auth-title").textContent = login ? "Welcome back" : "Create your account";
  $("auth-description").textContent = login ? "Log in to check your messages." : "Choose a username your friends can find.";
  $("auth-submit").innerHTML = login ? 'Log in <span>→</span>' : 'Create account <span>→</span>';
  $("password").autocomplete = login ? "current-password" : "new-password";
  $("password-help").hidden = login; $("auth-error").hidden = true;
}
function showAuth() { $("auth-view").hidden = false; $("mail-view").hidden = true; $("account-area").hidden = true; }
function showMail() {
  $("auth-view").hidden = true; $("mail-view").hidden = false; $("account-area").hidden = false;
  $("signed-in-as").textContent = `@${state.user.username}`;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function formatDate(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; return date.toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); }
function initials(name) { const clean = String(name || "?").replace(/^@/, ""); return (clean[0] || "?").toUpperCase(); }
function updateSearch() {
  const query = $("message-search").value.trim().toLowerCase();
  state.filteredMessages = state.messages.filter(m => [m.from,m.to,m.subject,m.body,m.preview].some(value => String(value || "").toLowerCase().includes(query)));
  renderMessages();
}
async function loadFolder(folder = state.folder) {
  state.folder = folder;
  document.querySelectorAll(".folder").forEach(button => button.classList.toggle("active", button.dataset.folder === folder));
  $("folder-title").textContent = folder === "inbox" ? "Inbox" : "Sent";
  $("panel-subtitle").textContent = folder === "inbox" ? "Messages from your friends, all in one place." : "The notes and messages you've sent.";
  $("message-search").value = "";
  $("message-list").innerHTML = '<div class="empty-state">Loading your mail…</div>'; showNotice("");
  try {
    const data = await api(folder === "inbox" ? "/inbox" : "/sent");
    state.messages = data.messages || [];
    if (folder === "inbox") $("inbox-count").textContent = state.messages.length ? state.messages.length : "";
    updateSearch();
  } catch (error) {
    if (/token|authorization/i.test(error.message)) { setToken(null); showAuth(); }
    else { $("message-list").innerHTML = '<div class="empty-state"><span class="empty-icon">!</span><strong>Could not load messages</strong><span>Please try refreshing.</span></div>'; showNotice(error.message, true); }
  }
}
function renderMessages() {
  const list = $("message-list"), messages = state.filteredMessages;
  $("message-total").textContent = `${messages.length} ${messages.length === 1 ? "message" : "messages"}`;
  if (!messages.length) {
    const searching = $("message-search").value.trim();
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">✉</span><strong>${searching ? "No matching messages" : `Your ${state.folder} is empty`}</strong><span>${searching ? "Try a different search." : state.folder === "inbox" ? "Messages from friends will show up here." : "Messages you send will show up here."}</span></div>`;
    return;
  }
  list.innerHTML = messages.map((m,index) => {
    const person = state.folder === "inbox" ? `@${m.from}` : `To: @${m.to}`;
    const preview = String(m.preview || m.body || "").replace(/\s+/g," ");
    return `<button class="message-row" type="button" data-message-index="${index}">
      <span class="message-person-wrap"><span class="message-avatar">${escapeHtml(initials(state.folder === "inbox" ? m.from : m.to))}</span><span class="message-person">${escapeHtml(person)}</span></span>
      <span class="message-preview"><strong>${escapeHtml(m.subject || "(No subject)")}</strong> — ${escapeHtml(preview)}</span>
      <span class="message-date">${escapeHtml(formatDate(m.created_at))}</span>
    </button>`;
  }).join("");
  list.querySelectorAll(".message-row").forEach(button => button.addEventListener("click", () => openMessage(messages[Number(button.dataset.messageIndex)])));
}
function openMessage(message) {
  state.selectedMessage = message;
  $("detail-meta").textContent = formatDate(message.created_at);
  $("detail-subject").textContent = message.subject || "(No subject)";
  $("detail-from").textContent = state.folder === "inbox" ? `From: @${message.from}` : `To: @${message.to}`;
  $("detail-body").textContent = message.body || "";
  $("reply-button").hidden = state.folder !== "inbox";
  $("message-dialog").showModal();
}
async function enterApp() { const data = await api("/me"); state.user = data.user; showMail(); await loadFolder("inbox"); }
function openCompose({to="",subject=""}={}) {
  $("compose-error").textContent = ""; $("compose-form").reset();
  $("recipient").value = to; $("subject").value = subject;
  $("compose-dialog").showModal();
  setTimeout(() => $("recipient").focus(), 50);
}
function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  $("theme-toggle").textContent = theme === "dark" ? "☀" : "☾";
  $("theme-toggle").title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  localStorage.setItem(THEME_KEY, theme);
}
$("login-tab").addEventListener("click", () => setMode("login"));
$("register-tab").addEventListener("click", () => setMode("register"));
$("auth-form").addEventListener("submit", async event => {
  event.preventDefault(); $("auth-error").hidden = true;
  const username = $("username").value.trim(), password = $("password").value;
  const submit = $("auth-submit"); submit.disabled = true; submit.textContent = state.mode === "login" ? "Logging in…" : "Creating account…";
  try {
    const data = await api(state.mode === "login" ? "/login" : "/register", {method:"POST",body:JSON.stringify({username,password})});
    setToken(data.token); state.user = data.user; $("password").value = ""; showMail(); await loadFolder("inbox");
  } catch(error) { $("auth-error").textContent = error.message; $("auth-error").hidden = false; }
  finally { submit.disabled = false; submit.innerHTML = state.mode === "login" ? 'Log in <span>→</span>' : 'Create account <span>→</span>'; }
});
$("logout-button").addEventListener("click", () => { setToken(null); state.user = null; state.messages = []; state.filteredMessages = []; showAuth(); setMode("login"); });
document.querySelectorAll(".folder").forEach(button => button.addEventListener("click", () => loadFolder(button.dataset.folder)));
$("refresh-button").addEventListener("click", () => loadFolder());
$("message-search").addEventListener("input", updateSearch);
$("compose-open").addEventListener("click", () => openCompose());
$("compose-close").addEventListener("click", () => $("compose-dialog").close());
$("detail-close").addEventListener("click", () => $("message-dialog").close());
$("reply-button").addEventListener("click", () => {
  const message = state.selectedMessage; if (!message) return;
  $("message-dialog").close();
  const subject = String(message.subject || "").toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject || ""}`;
  openCompose({to:message.from || "",subject});
});
$("compose-form").addEventListener("submit", async event => {
  event.preventDefault(); $("compose-error").textContent = "";
  const send = $("send-button"); send.disabled = true; send.textContent = "Sending…";
  try {
    await api("/send", {method:"POST",body:JSON.stringify({to:$("recipient").value.trim(),subject:$("subject").value.trim(),body:$("body").value})});
    $("compose-dialog").close(); await loadFolder("sent"); showNotice("Your message was sent successfully.");
  } catch(error) { $("compose-error").textContent = error.message; }
  finally { send.disabled = false; send.innerHTML = 'Send message <span>↗</span>'; }
});
$("theme-toggle").addEventListener("click", () => applyTheme(document.body.classList.contains("dark") ? "light" : "dark"));
document.addEventListener("keydown", event => {
  if (event.key === "/" && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName) && !$("mail-view").hidden) { event.preventDefault(); $("message-search").focus(); }
});

(async function start() {
  applyTheme(localStorage.getItem(THEME_KEY) || "light"); setMode("login");
  if (!API_BASE.startsWith("https://") || API_BASE.includes("YOUR-WORKER-NAME")) {
    showAuth(); $("auth-error").textContent = "The website still needs its Cloudflare Worker URL. Follow the setup guide to connect it."; $("auth-error").hidden = false; return;
  }
  if (token()) { try { await enterApp(); } catch { setToken(null); showAuth(); } } else showAuth();
})();
