/* CRM IDEAL — logica do app mobile (clone WhatsApp para atendimento bot/humano).
 *
 * Fonte da verdade: Supabase. bot_active = !contacts.bot_paused.
 * Tempo real: Supabase Realtime nas tabelas `messages` e `contacts`.
 * Auth: header `Authorization: Bearer <ADMIN_TOKEN>` (mesmo do painel /admin).
 */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ---------------- estado ----------------
  // Token embutido p/ login automatico (sem digitar). Tem que bater com o
  // ADMIN_TOKEN configurado na Vercel. Como vai no JS publico, o endpoint de
  // config NAO devolve mais segredos (chaves de API) — ver api/admin/config.ts.
  const BAKED_TOKEN = "crm_shoHLhRunngIfWB-19A-fANzFOX5RyBg";
  let token = localStorage.getItem("CRM_TOKEN") || BAKED_TOKEN;
  let cfg = {}; // { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY }
  let sb = null; // cliente supabase (realtime)
  let contacts = []; // lista de contatos
  const byId = {}; // wa_id -> contact
  let currentChat = null; // wa_id aberto
  const renderedIds = new Set(); // ids de mensagens ja na tela (dedupe)
  const unread = {}; // wa_id -> contador local de nao lidas
  let realtimeChannel = null;
  let pendingChat = null; // ?chat= ou clique em notificacao antes de carregar
  // Paginacao do historico do chat aberto.
  let chatOldestTs = null; // created_at da msg mais antiga ja carregada
  let chatHasMore = false; // ainda ha historico anterior?
  let chatLoadingMore = false; // trava anti-corrida

  // ---------------- helpers ----------------
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $("screen-" + name).classList.add("active");
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
  }

  function authedFetch(path, opts = {}) {
    const headers = Object.assign({}, opts.headers, {
      Authorization: "Bearer " + token,
    });
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  function initials(c) {
    const n = (c && (c.name || c.wa_id)) || "?";
    const parts = String(n).trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(n).slice(-2).toUpperCase();
  }

  // created_at pode vir como ISO (messages) ou epoch ms (last_seen_at). Normaliza.
  function parseTs(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (/^\d+$/.test(String(v))) return Number(v);
    const t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  function fmtTime(v) {
    const t = parseTs(v);
    if (!t) return "";
    const d = new Date(t);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  function displayName(c) {
    return (c && (c.name || c.wa_id)) || "Contato";
  }

  // ---------------- LOGIN ----------------
  async function doLogin(tok) {
    $("login-error").textContent = "";
    if (!tok) {
      $("login-error").textContent = "Informe o token de acesso.";
      return;
    }
    try {
      const res = await fetch("/api/admin/config", {
        headers: { Authorization: "Bearer " + tok },
      });
      if (res.status === 401) {
        $("login-error").textContent = "Token inválido.";
        localStorage.removeItem("CRM_TOKEN");
        showScreen("login");
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      cfg = await res.json();
      token = tok;
      localStorage.setItem("CRM_TOKEN", tok);
      await start();
    } catch (e) {
      $("login-error").textContent = "Falha ao conectar. Verifique a conexão.";
      showScreen("login");
    }
  }

  // ---------------- START (pos-login) ----------------
  async function start() {
    showScreen("list");
    connectSupabase();
    registerServiceWorker();
    refreshNotifBtn();
    await loadContacts();
    subscribeRealtime();
    // ?chat= (abertura via notificacao push)
    const params = new URLSearchParams(location.search);
    const chat = pendingChat || params.get("chat");
    if (chat && byId[chat]) openChat(chat);
  }

  function connectSupabase() {
    try {
      if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
    } catch (e) {
      console.warn("[CRM] Supabase indisponível:", e);
    }
  }

  function setBanner(text, ok) {
    const b = $("conn-banner");
    if (!text) {
      b.classList.add("hidden");
      return;
    }
    b.textContent = text;
    b.classList.toggle("ok", !!ok);
    b.classList.remove("hidden");
    if (ok) setTimeout(() => b.classList.add("hidden"), 2500);
  }

  // ---------------- CONTATOS ----------------
  async function loadContacts() {
    try {
      const res = await authedFetch("/api/admin/contacts");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      contacts = data.contacts || [];
      for (const c of contacts) byId[c.wa_id] = c;
      renderContacts();
    } catch (e) {
      setBanner("Sem conexão com o servidor. Tentando reconectar…");
    }
  }

  function sortedContacts() {
    return contacts
      .slice()
      .sort((a, b) => parseTs(b.last_message_at || b.last_seen_at) - parseTs(a.last_message_at || a.last_seen_at));
  }

  function renderContacts() {
    const q = ($("search-input").value || "").toLowerCase().trim();
    const list = $("contacts-list");
    list.innerHTML = "";
    const items = sortedContacts().filter((c) => {
      if (!q) return true;
      return (
        displayName(c).toLowerCase().includes(q) ||
        String(c.wa_id).includes(q) ||
        String(c.last_message || "").toLowerCase().includes(q)
      );
    });
    $("list-empty").classList.toggle("hidden", items.length > 0);
    for (const c of items) list.appendChild(contactRow(c));
  }

  function contactRow(c) {
    const li = document.createElement("li");
    li.className = "contact";
    li.dataset.wa = c.wa_id;
    const botActive = !c.bot_paused;
    const n = unread[c.wa_id] || 0;
    const preview = c.last_message_role === "user" ? "" : c.last_message_role === "assistant" ? "✓ " : "";
    li.innerHTML = `
      <div class="contact-avatar">${initials(c)}
        <span class="status-dot ${botActive ? "bot" : "manual"}"></span>
      </div>
      <div class="contact-main">
        <div class="contact-top">
          <span class="contact-name">${escapeHtml(displayName(c))}</span>
          <span class="contact-time">${fmtTime(c.last_message_at || c.last_seen_at)}</span>
        </div>
        <div class="contact-bottom">
          <span class="contact-preview">${escapeHtml(preview + (c.last_message || ""))}</span>
          ${n > 0 ? `<span class="unread-badge">${n > 99 ? "99+" : n}</span>` : `<span class="tag ${botActive ? "bot" : "manual"}">${botActive ? "Bot" : "Manual"}</span>`}
        </div>
      </div>`;
    li.addEventListener("click", () => openChat(c.wa_id));
    return li;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // ---------------- CHAT ----------------
  async function openChat(waId) {
    currentChat = waId;
    renderedIds.clear();
    unread[waId] = 0;
    const c = byId[waId] || { wa_id: waId };
    $("chat-name").textContent = displayName(c);
    $("chat-avatar").textContent = initials(c);
    $("messages").innerHTML = "";
    updateChatHeader(c);
    updateBotControls(c);
    showScreen("chat");
    await loadMessages(waId);
    renderContacts(); // zera badge
  }

  function updateChatHeader(c) {
    const el = $("chat-status");
    const botActive = !c.bot_paused;
    el.textContent = botActive ? "🤖 Bot ativo" : "🟡 Atendimento manual";
    el.className = "chat-status " + (botActive ? "bot" : "manual");
  }

  async function loadMessages(waId) {
    chatOldestTs = null;
    chatHasMore = false;
    chatLoadingMore = false;
    try {
      const res = await authedFetch(`/api/admin/contacts/${encodeURIComponent(waId)}/messages?limit=50`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const msgs = data.messages || [];
      chatHasMore = !!data.hasMore;
      if (msgs.length > 0) chatOldestTs = msgs[0].created_at;
      for (const m of msgs) renderMessage(m, false);
      scrollToBottom();
    } catch (e) {
      toast("Não consegui carregar o histórico.");
    }
  }

  // Carrega o lote anterior ao rolar pro topo, preservando a posicao de scroll.
  async function loadOlderMessages() {
    if (chatLoadingMore || !chatHasMore || !currentChat || chatOldestTs == null) return;
    chatLoadingMore = true;
    const box = $("messages");
    try {
      const res = await authedFetch(
        `/api/admin/contacts/${encodeURIComponent(currentChat)}/messages?limit=50&before=${encodeURIComponent(chatOldestTs)}`
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const msgs = data.messages || [];
      chatHasMore = !!data.hasMore;
      if (msgs.length === 0) return;
      chatOldestTs = msgs[0].created_at;
      const anchor = box.firstChild; // tudo entra ACIMA do que ja esta na tela
      const prevHeight = box.scrollHeight;
      const prevTop = box.scrollTop;
      for (const m of msgs) {
        const el = buildMessageEl(m);
        if (el) box.insertBefore(el, anchor);
      }
      box.scrollTop = prevTop + (box.scrollHeight - prevHeight);
    } catch (e) {
      /* silencioso: tenta de novo no proximo scroll */
    } finally {
      chatLoadingMore = false;
    }
  }

  // Constroi o elemento de uma mensagem (ou null se tool/duplicada). Nao insere.
  function buildMessageEl(m) {
    if (m.role === "tool") return null;
    const id = String(m.id != null ? m.id : `${m.role}:${m.created_at}:${(m.content || "").slice(0, 16)}`);
    if (renderedIds.has(id)) return null; // dedupe (stress test: nunca duplica)
    renderedIds.add(id);

    const div = document.createElement("div");
    if (m.role === "system") {
      div.className = "msg system";
      div.textContent = m.content || "";
    } else {
      const out = m.role === "assistant";
      div.className = "msg " + (out ? "out" : "in");
      const time = fmtTime(m.created_at) || fmtTime(Date.now());
      div.innerHTML = `${escapeHtml(m.content || "")}<span class="msg-time">${time}${out ? '<span class="read-ticks">✓✓</span>' : ""}</span>`;
    }
    return div;
  }

  function renderMessage(m, animate) {
    const el = buildMessageEl(m);
    if (el) $("messages").appendChild(el);
  }

  function scrollToBottom() {
    const m = $("messages");
    m.scrollTop = m.scrollHeight;
  }

  // ---------------- CONTROLE BOT vs MANUAL ----------------
  // bot_active = !bot_paused. Caixa habilitada SO em atendimento manual.
  function updateBotControls(c) {
    const manual = !!c.bot_paused;
    const input = $("composer-input");
    const sendBtn = $("send-btn");
    const toggle = $("bot-toggle");

    input.disabled = !manual;
    sendBtn.disabled = !manual;
    input.placeholder = manual ? "Digite uma mensagem" : "Bot operando. Assuma o controle para digitar.";

    if (manual) {
      toggle.classList.add("resume");
      $("bot-toggle-icon").textContent = "▶";
      $("bot-toggle-label").textContent = "Reativar Bot";
    } else {
      toggle.classList.remove("resume");
      $("bot-toggle-icon").textContent = "⏸";
      $("bot-toggle-label").textContent = "Pausar Bot";
      input.value = "";
    }
  }

  async function toggleBot() {
    if (!currentChat) return;
    const c = byId[currentChat] || { wa_id: currentChat };
    const willPause = !c.bot_paused; // se bot ativo -> pausar
    const toggle = $("bot-toggle");
    toggle.disabled = true;
    try {
      const res = await authedFetch(`/api/admin/contacts/${encodeURIComponent(currentChat)}/pause`, {
        method: "PATCH",
        body: JSON.stringify({ paused: willPause }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      // Atualizacao otimista — o Realtime confirma logo em seguida.
      c.bot_paused = willPause;
      byId[currentChat] = c;
      updateChatHeader(c);
      updateBotControls(c);
      renderContacts();
      if (willPause) {
        renderMessage({ id: "sys-manual-" + Date.now(), role: "system", content: "Atendimento manual iniciado", created_at: Date.now() }, true);
        scrollToBottom();
        const input = $("composer-input");
        input.disabled = false;
        input.focus(); // sobe o teclado do celular
      } else {
        renderMessage({ id: "sys-bot-" + Date.now(), role: "system", content: "Bot reativado", created_at: Date.now() }, true);
        scrollToBottom();
      }
    } catch (e) {
      toast("Não consegui alterar o estado do bot.");
    } finally {
      toggle.disabled = false;
    }
  }

  // ---------------- ENVIAR (atendente humano) ----------------
  async function sendMessage() {
    const input = $("composer-input");
    const text = input.value.trim();
    if (!text || !currentChat) return;
    const sendBtn = $("send-btn");
    sendBtn.disabled = true;
    try {
      const res = await authedFetch(`/api/admin/contacts/${encodeURIComponent(currentChat)}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Falha ao enviar.");
        sendBtn.disabled = false;
        return;
      }
      input.value = "";
      autoGrow();
      // POST ja pausa o bot no servidor. Reflete local e recarrega (dedupe por id).
      const c = byId[currentChat] || { wa_id: currentChat };
      c.bot_paused = true;
      byId[currentChat] = c;
      updateChatHeader(c);
      updateBotControls(c);
      await loadMessages(currentChat);
    } catch (e) {
      toast("Sem conexão. Mensagem não enviada.");
    } finally {
      $("send-btn").disabled = !currentChat || !byId[currentChat] || !byId[currentChat].bot_paused;
    }
  }

  function autoGrow() {
    const ta = $("composer-input");
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  // ---------------- REALTIME ----------------
  function subscribeRealtime() {
    if (!sb) {
      setBanner("Tempo real indisponível — recarregue para atualizar.");
      return;
    }
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    realtimeChannel = sb
      .channel("crm-ideal")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        onNewMessage(payload.new);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, (payload) => {
        onContactChange(payload.new);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setBanner("Conectado em tempo real", true);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setBanner("Reconectando ao tempo real…");
      });
  }

  function onNewMessage(m) {
    if (!m || !m.wa_id) return;
    const c = byId[m.wa_id] || { wa_id: m.wa_id };
    // atualiza preview/ordenacao da lista
    if (m.role !== "tool" && m.role !== "system") {
      c.last_message = m.content || "";
      c.last_message_role = m.role;
      c.last_message_at = m.created_at;
      if (!byId[m.wa_id]) {
        byId[m.wa_id] = c;
        contacts.push(c);
      }
    }
    if (m.wa_id === currentChat) {
      renderMessage(m, true);
      scrollToBottom();
    } else if (m.role === "user") {
      unread[m.wa_id] = (unread[m.wa_id] || 0) + 1;
    }
    renderContacts();
  }

  function onContactChange(row) {
    if (!row || !row.wa_id) return;
    const existing = byId[row.wa_id] || {};
    const merged = Object.assign({}, existing, row);
    byId[row.wa_id] = merged;
    if (!contacts.find((c) => c.wa_id === row.wa_id)) contacts.push(merged);
    if (row.wa_id === currentChat) {
      updateChatHeader(merged);
      updateBotControls(merged);
    }
    renderContacts();
  }

  // ---------------- WEB PUSH ----------------
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/app/sw.js").catch((e) => console.warn("[CRM] SW:", e));
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data && ev.data.type === "open-chat" && ev.data.wa_id) {
        if (byId[ev.data.wa_id]) openChat(ev.data.wa_id);
        else pendingChat = ev.data.wa_id;
      }
    });
  }

  function refreshNotifBtn() {
    const btn = $("notif-btn");
    if (!("Notification" in window)) {
      btn.classList.add("hidden");
      return;
    }
    btn.classList.toggle("on", Notification.permission === "granted");
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function enableNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("Este dispositivo não suporta notificações push.");
      return;
    }
    if (!cfg.VAPID_PUBLIC_KEY) {
      toast("Push não configurado no servidor (VAPID).");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast("Permissão de notificação negada.");
        refreshNotifBtn();
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      const res = await authedFetch("/api/admin/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      toast("Notificações ativadas neste aparelho.");
      refreshNotifBtn();
    } catch (e) {
      console.warn("[CRM] push:", e);
      toast("Não consegui ativar as notificações.");
    }
  }

  // ---------------- LISTENERS ----------------
  $("login-btn").addEventListener("click", () => doLogin($("login-token").value.trim()));
  $("login-token").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin($("login-token").value.trim());
  });
  $("logout-btn").addEventListener("click", () => {
    localStorage.removeItem("CRM_TOKEN");
    if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
    location.reload();
  });
  $("notif-btn").addEventListener("click", enableNotifications);
  $("search-input").addEventListener("input", renderContacts);
  // Scroll infinito: perto do topo, carrega o historico anterior.
  $("messages").addEventListener("scroll", () => {
    if ($("messages").scrollTop < 80) loadOlderMessages();
  });
  $("back-btn").addEventListener("click", () => {
    currentChat = null;
    showScreen("list");
    renderContacts();
  });
  $("bot-toggle").addEventListener("click", toggleBot);
  $("send-btn").addEventListener("click", sendMessage);
  $("composer-input").addEventListener("input", autoGrow);
  $("composer-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ---------------- BOOT ----------------
  function boot() {
    // Login automatico: tenta o token salvo/embutido. So mostra a tela de
    // login se o token for rejeitado (fallback).
    doLogin(token).catch(() => showScreen("login"));
  }
  if (window.supabase) boot();
  else window.addEventListener("load", boot);
})();
