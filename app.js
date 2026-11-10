// Set this to your deployed Cloudflare Worker URL, ending in /api (no trailing slash).
const API_BASE = "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/api";
const TOKEN_KEY = "friendmail_session";

const $ = (id) => document.getElementById(id);
const state = { mode: "login", folder: "inbox", messages: [], user: null };

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
  const el = $("status-message");
  el.textContent = message;
  el.className = isError ? "notice error" : "notice";
  el.hidden = !message;
}
function setMode(mode) {
  state.mode = mode;
  const login = mode === "login";
  $("login-tab").classList.toggle("active", login);
  $("register-tab").classList.toggle("active", !login);
  $("login-tab").setAttribute("aria-selected", String(login));
  $("register-tab").setAttribute("aria-selected", String(!login));
  $("auth-title").textContent = login ? "Welcome back" : "Create your account";
  $("auth-description").textContent = login ? "Log in to check your messages." : "Choose a username your friends can find.";
  $("auth-submit").textContent = login ? "Log in" : "Create account";
  $("password").autocomplete = login ? "current-password" : "new-password";
  $("password-help").hidden = login;
  $("auth-error").hidden = true;
}
function showAuth() {
  $("auth-view").hidden = false;
  $("mail-view").hidden = true;
  $("account-area").hidden = true;
}
function showMail() {
  $("auth-view").hidden = true;
  $("mail-view").hidden = false;
  $("account-area").hidden = false;
  $("signed-in-as").textContent = `Signed in as @${state.user.username}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
async function loadFolder(folder = state.folder) {
  state.folder = folder;
  document.querySelectorAll(".folder").forEach(button => button.classList.toggle("active", button.dataset.folder === folder));
  $("folder-title").textContent = folder === "inbox" ? "Inbox" : "Sent";
  $("message-list").innerHTML = '<div class="empty-state">Loading your mail…</div>';
  showNotice("");
  try {
    const data = await api(folder === "inbox" ? "/inbox" : "/sent");
    state.messages = data.messages || [];
    renderMessages();
  } catch (error) {
    if (error.message.toLowerCase().includes("token") || error.message.toLowerCase().includes("authorization")) {
      setToken(null); showAuth();
    } else {
      $("message-list").innerHTML = '<div class="empty-state">Could not load messages.</div>';
      showNotice(error.message, true);
    }
  }
}
function renderMessages() {
  const list = $("message-list");
  if (!state.messages.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">✉</span><strong>Your ${state.folder} is empty</strong><br><span>${state.folder === "inbox" ? "Messages from friends will show up here." : "Messages you send will show up here."}</span></div>`;
    return;
  }
  list.innerHTML = state.messages.map((m, index) => {
    const person = state.folder === "inbox" ? `@${m.from}` : `To: @${m.to}`;
    return `<button class="message-row" type="button" data-message-index="${index}">
      <span class="message-person">${escapeHtml(person)}</span>
      <span class="message-preview"><strong>${escapeHtml(m.subject)}</strong> — ${escapeHtml(m.preview || m.body)}</span>
      <span class="message-date">${escapeHtml(formatDate(m.created_at))}</span>
    </button>`;
  }).join("");
  list.querySelectorAll(".message-row").forEach(button => button.addEventListener("click", () => openMessage(state.messages[Number(button.dataset.messageIndex)])));
}
function openMessage(message) {
  $("detail-meta").textContent = formatDate(message.created_at);
  $("detail-subject").textContent = message.subject;
  $("detail-from").textContent = state.folder === "inbox" ? `From: @${message.from}` : `To: @${message.to}`;
  $("detail-body").textContent = message.body;
  $("message-dialog").showModal();
}
async function enterApp() {
  const data = await api("/me");
  state.user = data.user;
  showMail();
  await loadFolder("inbox");
}
$("login-tab").addEventListener("click", () => setMode("login"));
$("register-tab").addEventListener("click", () => setMode("register"));
$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("auth-error").hidden = true;
  const username = $("username").value.trim();
  const password = $("password").value;
  $("auth-submit").disabled = true;
  $("auth-submit").textContent = state.mode === "login" ? "Logging in…" : "Creating…";
  try {
    const data = await api(state.mode === "login" ? "/login" : "/register", {
      method: "POST", body: JSON.stringify({ username, password })
    });
    setToken(data.token);
    state.user = data.user;
    $("password").value = "";
    showMail();
    await loadFolder("inbox");
  } catch (error) {
    $("auth-error").textContent = error.message;
    $("auth-error").hidden = false;
  } finally {
    $("auth-submit").disabled = false;
    $("auth-submit").textContent = state.mode === "login" ? "Log in" : "Create account";
  }
});
$("logout-button").addEventListener("click", () => {
  setToken(null); state.user = null; state.messages = []; showAuth(); setMode("login");
});
document.querySelectorAll(".folder").forEach(button => button.addEventListener("click", () => loadFolder(button.dataset.folder)));
$("refresh-button").addEventListener("click", () => loadFolder());
$("compose-open").addEventListener("click", () => { $("compose-error").textContent = ""; $("compose-form").reset(); $("compose-dialog").showModal(); });
$("compose-close").addEventListener("click", () => $("compose-dialog").close());
$("detail-close").addEventListener("click", () => $("message-dialog").close());
$("compose-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("compose-error").textContent = "";
  const send = $("send-button");
  send.disabled = true; send.textContent = "Sending…";
  try {
    await api("/send", { method: "POST", body: JSON.stringify({
      to: $("recipient").value.trim(), subject: $("subject").value.trim(), body: $("body").value
    }) });
    $("compose-dialog").close();
    await loadFolder("sent");
    showNotice("Your message was sent.");
  } catch (error) {
    $("compose-error").textContent = error.message;
  } finally {
    send.disabled = false; send.textContent = "Send message ↗";
  }
});

(async function start() {
  setMode("login");
  if (!API_BASE.startsWith("https://") || API_BASE.includes("YOUR-WORKER-NAME")) {
    showAuth();
    $("auth-error").textContent = "The website still needs its Cloudflare Worker URL. Follow the setup guide to connect it.";
    $("auth-error").hidden = false;
    return;
  }
  if (token()) {
    try { await enterApp(); }
    catch { setToken(null); showAuth(); }
  } else showAuth();
})();
