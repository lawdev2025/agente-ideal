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
  let token = localStorage.getItem("CRM_TOKEN") || "";
  let currentUser = null; // { id, name, role, unit, must_change_password }
  let pendingPwd = "";    // senha atual guardada durante troca obrigatória
  let cfg = {}; // { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY }
  let sb = null; // cliente supabase (realtime)
  let contacts = []; // lista de contatos
  const byId = {}; // wa_id -> contact
  let currentChat = null; // wa_id aberto
  const renderedIds = new Set(); // ids de mensagens ja na tela (dedupe)
  const unread = {}; // wa_id -> contador local de nao lidas
  let realtimeChannel = null;
  let reconnectTimer = null; // reconexão do realtime após queda
  let safetyTimer = null;    // poll de segurança (realtime cai às vezes)
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
  async function doLogin(login, password) {
    $("login-error").textContent = "";
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      if (!r.ok) {
        $("login-error").textContent = (await r.json().catch(() => ({}))).error || "Login inválido.";
        showScreen("login");
        return;
      }
      const data = await r.json();
      token = data.token;
      localStorage.setItem("CRM_TOKEN", token);
      currentUser = data.user;
      if (data.user.must_change_password) { pendingPwd = password; showScreen("change"); return; }
      await startApp();
    } catch (e) {
      $("login-error").textContent = "Falha ao conectar.";
      showScreen("login");
    }
  }

  // Troca de senha obrigatória (primeiro acesso).
  async function changePassword(np) {
    const r = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ currentPassword: pendingPwd, newPassword: np }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Falha ao trocar senha");
  }

  // ---------------- START (pos-login) ----------------
  async function startApp() {
    // Busca configurações do servidor (Supabase keys, VAPID etc.)
    try {
      const res = await fetch("/api/admin/config", { headers: { Authorization: "Bearer " + token } });
      if (res.ok) cfg = await res.json();
    } catch (_) { /* continua sem realtime se falhar */ }

    showScreen("list");
    connectSupabase();
    registerServiceWorker();
    refreshNotifBtn();
    await loadContacts();
    subscribeRealtime();
    startSafetyNet();
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
    updateListHeader();
  }

  // Ícone de "precisa de atendimento" (pulsa quando o bot está pausado/escalado).
  const HEADSET_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 1a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z"></path></svg>';

  // Tag de intenção → rótulo + classe de cor (selo ao lado do nome).
  function tagInfo(tag) {
    switch (tag) {
      case "matricula": return { label: "Matrícula", cls: "itag-matricula" };
      case "rematricula": return { label: "Rematrícula", cls: "itag-rematricula" };
      case "eixo": return { label: "Eixo", cls: "itag-eixo" };
      case "esporte": return { label: "Esporte", cls: "itag-esporte" };
      default: return null;
    }
  }

  // Variante de cor do avatar (a1..a4) determinística por wa_id.
  function avatarVariant(wa) {
    let h = 0;
    const s = String(wa || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "a" + (1 + (h % 4));
  }

  // Ícones SVG das ações de swipe (mesmos do protótipo proto-screens.jsx).
  const SWIPE_ICON = {
    pause: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.4"></rect><rect x="14" y="4" width="4" height="16" rx="1.4"></rect></svg>',
    play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>',
    check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 7"></path></svg>',
  };
  const SWIPE_OPEN = -156; // quanto o card abre revelando as ações

  function contactRow(c) {
    const wrap = document.createElement("div");
    wrap.className = "card-wrap";
    wrap.dataset.wa = c.wa_id;
    const st = c.bot_paused ? "manual" : "bot";
    const n = unread[c.wa_id] || 0;
    const av = avatarVariant(c.wa_id);
    const preview = c.last_message_role === "user" ? "" : c.last_message_role === "assistant" ? "✓ " : "";
    const ti = tagInfo(c.tag);
    const tagHtml = ti ? `<span class="itag ${ti.cls}">${ti.label}</span>` : "";
    const utHtml = c.unit_tag ? `<span class="utag utag-${String(c.unit_tag).toLowerCase()}">${escapeHtml(c.unit_tag)}</span>` : "";
    const attnHtml = c.bot_paused ? `<span class="attn-ic" title="Precisa de atendimento humano">${HEADSET_SVG}</span>` : "";
    wrap.innerHTML = `
      <div class="card-in" style="position:relative;border-radius:18px">
        <div class="swipe-actions">
          <button class="swipe-act act-pause" style="background:var(--warn)">${st === "bot" ? SWIPE_ICON.pause : SWIPE_ICON.play}${st === "bot" ? "Pausar" : "Reativar"}</button>
          <button class="swipe-act act-done" style="background:var(--ok)">${SWIPE_ICON.check}Concluir</button>
        </div>
        <div class="card swipe-front">
          <div class="row">
            <div class="avatar ${av}">${initials(c)}<span class="st-dot ${st}"></span></div>
            <div class="row-main">
              <div class="row-top">
                <span class="row-name-wrap"><span class="row-name">${escapeHtml(displayName(c))}</span>${attnHtml}${tagHtml}${utHtml}</span>
                <span class="row-time${n ? " unread" : ""}">${fmtTime(c.last_message_at || c.last_seen_at)}</span>
              </div>
              <div class="row-bottom">
                <span class="row-preview">${escapeHtml(preview + (c.last_message || ""))}</span>
                ${n > 0 ? `<span class="badge">${n > 99 ? "99+" : n}</span>` : `<span class="chip ${st}">${st === "bot" ? "Bot" : "Time"}</span>`}
              </div>
            </div>
          </div>
        </div>
      </div>`;
    attachSwipe(wrap, c.wa_id);
    return wrap;
  }

  // Swipe horizontal no card (estilo proto): puxa pra esquerda e revela
  // "Pausar/Reativar" (real) + "Concluir" (descarte local). Toque curto = abrir.
  function attachSwipe(wrap, waId) {
    const front = wrap.querySelector(".swipe-front");
    const s = { active: false, x: 0, y: 0, base: 0, dir: null, moved: 0, dx: 0 };
    const setDx = (v) => { s.dx = v; front.style.transform = "translateX(" + v + "px)"; };

    front.addEventListener("pointerdown", (e) => {
      s.active = true; s.x = e.clientX; s.y = e.clientY; s.base = s.dx; s.dir = null; s.moved = 0;
      front.classList.add("dragging");
    });
    front.addEventListener("pointermove", (e) => {
      if (!s.active) return;
      const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
      if (!s.dir) {
        if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
        // Só vira "swipe horizontal" se o gesto for CLARAMENTE horizontal.
        // Qualquer ambiguidade → "v": deixa a lista rolar nativamente.
        s.dir = Math.abs(ddx) > Math.abs(ddy) * 1.3 ? "h" : "v";
        if (s.dir === "h") { try { front.setPointerCapture(e.pointerId); } catch (_) {} }
      }
      if (s.dir !== "h") return;             // vertical → não mexe no card (rola a lista)
      s.moved = Math.abs(ddx);
      let v = s.base + ddx;
      if (v > 0) v = v * 0.2;                          // resistência ao puxar pra direita
      if (v < SWIPE_OPEN) v = SWIPE_OPEN + (v - SWIPE_OPEN) * 0.25; // resistência além do aberto
      setDx(v);
    });
    const up = () => {
      if (!s.active) return;
      s.active = false;
      front.classList.remove("dragging");
      if (s.dir === "v") return;             // arrasto vertical = rolagem da lista, ignora
      if (!s.dir) {                          // não passou do threshold → toque curto
        if (s.dx !== 0) { setDx(0); return; } // estava aberto: só fecha
        openChat(waId); return;
      }
      setDx(s.dx < SWIPE_OPEN * 0.4 ? SWIPE_OPEN : 0); // horizontal: snap aberto/fechado
    };
    front.addEventListener("pointerup", up);
    // Cancel (browser assumiu a rolagem nativa): nunca abre o chat.
    front.addEventListener("pointercancel", () => {
      if (!s.active) return;
      s.active = false;
      front.classList.remove("dragging");
      if (s.dir === "h") setDx(s.dx < SWIPE_OPEN * 0.4 ? SWIPE_OPEN : 0);
    });

    wrap.querySelector(".act-pause").addEventListener("click", (e) => {
      e.stopPropagation();
      setDx(0);
      setPaused(waId);
    });
    wrap.querySelector(".act-done").addEventListener("click", (e) => {
      e.stopPropagation();
      // Sem estado "concluído" no backend: descarte local com a animação do proto.
      // O card reaparece num refresh — é cosmético até existir um flag no servidor.
      wrap.classList.add("removing");
      unread[waId] = 0;
      setTimeout(() => wrap.remove(), 400);
    });
  }

  // Pausa/reativa o bot de um contato qualquer da lista (usado pelo swipe).
  async function setPaused(waId) {
    const c = byId[waId] || { wa_id: waId };
    const willPause = !c.bot_paused;
    try {
      const res = await authedFetch(`/api/admin/contacts/${encodeURIComponent(waId)}/pause`, {
        method: "PATCH",
        body: JSON.stringify({ paused: willPause }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      c.bot_paused = willPause;
      byId[waId] = c;
      if (waId === currentChat) { updateChatHeader(c); updateBotControls(c); }
      renderContacts();
    } catch (e) {
      toast("Não consegui alterar o estado do bot.");
    }
  }

  // Atualiza o cabeçalho vermelho da lista: saudação + tiles de contagem.
  function updateListHeader() {
    const total = contacts.length;
    const nBot = contacts.filter((c) => !c.bot_paused).length;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("stat-conversas", total);
    set("stat-bot", nBot);
    set("stat-time", total - nBot);
    const h = new Date().getHours();
    set("greeting", h < 12 ? "Bom dia," : h < 18 ? "Boa tarde," : "Boa noite,");
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
    const botActive = !c.bot_paused;
    $("chat-status").textContent = botActive ? "Bot ativo" : "Você está atendendo";
    $("chat-dot").className = "hdr-dot " + (botActive ? "bot" : "manual");
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

  function buildMediaHtml(m) {
    if (!m.media_type || !m.media_url) return "";
    const url = escapeHtml(m.media_url);
    const t = m.media_type;
    if (t === "image" || t === "sticker")
      return `<a href="${url}" target="_blank" rel="noopener"><img class="msg-media-img" src="${url}" alt="Imagem" loading="lazy"></a>`;
    if (t === "video")
      return `<video class="msg-media-video" controls preload="none"><source src="${url}" type="${escapeHtml(m.media_mime || "video/mp4")}"></video>`;
    if (t === "audio")
      return `<audio class="msg-media-audio" controls preload="none"><source src="${url}" type="${escapeHtml(m.media_mime || "audio/ogg")}"></audio>`;
    if (t === "document") {
      const name = escapeHtml(m.media_filename || "Arquivo");
      const docSvg = `<svg class="doc-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
      return `<a class="msg-doc-link" href="${url}" target="_blank" rel="noopener" download>${docSvg}<span>${name}</span></a>`;
    }
    return "";
  }

  // Constroi o elemento de uma mensagem (ou null se tool/duplicada). Nao insere.
  function buildMessageEl(m) {
    if (m.role === "tool") return null;
    const id = String(m.id != null ? m.id : `${m.role}:${m.created_at}:${(m.content || "").slice(0, 16)}`);
    if (renderedIds.has(id)) return null; // dedupe (stress test: nunca duplica)
    renderedIds.add(id);

    const div = document.createElement("div");
    if (m.role === "system") {
      div.className = "msg system msg-in";
      div.textContent = m.content || "";
    } else {
      const out = m.role === "assistant";
      div.className = "msg " + (out ? "out solid" : "in") + " msg-in";
      const time = fmtTime(m.created_at) || fmtTime(Date.now());
      const mediaHtml = buildMediaHtml(m);
      const autoPlaceholder = /^\[(imagem|vídeo|áudio|sticker|documento|arquivo)/i.test(m.content || "");
      const textHtml = (m.content && (!mediaHtml || !autoPlaceholder))
        ? `<div>${escapeHtml(m.content)}</div>` : "";
      // Nome do atendente que respondeu (aparece embaixo na bolha do assistente/saída)
      const agentHtml = (out && m.agent_name) ? `<small class="msg-agent">— ${escapeHtml(m.agent_name)}</small>` : "";
      div.innerHTML = `${mediaHtml}${textHtml}${agentHtml}<span class="msg-time">${time}${out ? " ✓✓" : ""}</span>`;
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
  const MS_24H = 24 * 60 * 60 * 1000;
  function windowClosed(c) {
    const ts = c?.last_seen_at ?? c?.last_message_at;
    return ts ? (Date.now() - parseTs(ts)) > MS_24H : false;
  }

  function updateBotControls(c) {
    const manual = !!c.bot_paused;
    const closed = manual && windowClosed(c);
    const input = $("composer-input");
    const sendBtn = $("send-btn");
    const toggle = $("bot-toggle");
    const attachBtn = $("app-attach-btn");

    // Banner de janela fechada
    let banner = $("win24h-banner");
    if (closed) {
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "win24h-banner";
        banner.className = "win24h-banner";
        banner.textContent = "⏰ Janela de 24h encerrada — aguarde o cliente escrever para responder";
        const composer = document.querySelector(".composer");
        if (composer) composer.parentNode.insertBefore(banner, composer);
      }
    } else {
      if (banner) banner.remove();
    }

    const micBtn = $("app-mic-btn");
    input.disabled = !manual || closed;
    sendBtn.disabled = !manual || closed;
    if (attachBtn) attachBtn.disabled = !manual || closed;
    if (micBtn) micBtn.disabled = !manual || closed;
    sendBtn.classList.toggle("off", !manual || closed || !input.value.trim());
    input.placeholder = closed
      ? "Janela de 24h encerrada — aguarde o cliente escrever"
      : (manual ? "Mensagem" : "Bot operando — pause para responder");

    if (manual) {
      toggle.className = "pill-toggle resume";
      $("bot-toggle-icon").textContent = "▶";
      $("bot-toggle-label").textContent = "Reativar bot";
    } else {
      toggle.className = "pill-toggle pause";
      $("bot-toggle-icon").textContent = "⏸";
      $("bot-toggle-label").textContent = "Pausar bot e assumir";
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

  // ---------------- GRAVAÇÃO DE ÁUDIO ----------------
  let _appMediaRec = null;
  let _appAudioChunks = [];
  let _appRecTimer = null;
  let _appRecSeconds = 0;

  function _appAudioMime() {
    for (const t of ["audio/ogg;codecs=opus","audio/mp4","audio/ogg","audio/webm;codecs=opus","audio/webm"]) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  function _appAudioExt(mime) {
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("ogg")) return "ogg";
    return "webm";
  }

  function toggleAppAudioRecording() {
    if (_appMediaRec && _appMediaRec.state === "recording") {
      _appStopRecording();
    } else {
      _appStartRecording();
    }
  }

  function _appStartRecording() {
    if (!currentChat) return;
    const c = byId[currentChat];
    if (windowClosed(c)) { toast("Janela de 24h encerrada."); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      _appAudioChunks = [];
      const mime = _appAudioMime();
      _appMediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      _appMediaRec.ondataavailable = e => { if (e.data.size > 0) _appAudioChunks.push(e.data); };
      _appMediaRec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const finalMime = _appMediaRec.mimeType || "audio/webm";
        const blob = new Blob(_appAudioChunks, { type: finalMime.split(";")[0] });
        _appShowPreview(blob);
      };
      _appMediaRec.start();
      _appRecSeconds = 0;
      _appShowRecBar();
      _appRecTimer = setInterval(() => {
        _appRecSeconds++;
        const el = document.getElementById("app-rec-timer");
        if (el) el.textContent = Math.floor(_appRecSeconds/60) + ":" + String(_appRecSeconds%60).padStart(2,"0");
        if (_appRecSeconds >= 120) _appStopRecording();
      }, 1000);
    }).catch(err => toast("Microfone não disponível: " + (err.message || err)));
  }

  function _appStopRecording() {
    if (_appMediaRec && _appMediaRec.state !== "inactive") _appMediaRec.stop();
    clearInterval(_appRecTimer); _appRecTimer = null;
    _appRemoveBars();
    const micBtn = $("app-mic-btn");
    if (micBtn) micBtn.classList.remove("recording");
  }

  function _appShowRecBar() {
    _appRemoveBars();
    const micBtn = $("app-mic-btn");
    if (micBtn) micBtn.classList.add("recording");
    const composer = document.querySelector(".composer");
    if (!composer) return;
    const bar = document.createElement("div");
    bar.id = "app-audio-rec-bar";
    bar.className = "app-audio-rec-bar";
    bar.innerHTML = `<span class="app-audio-rec-dot"></span><span class="app-audio-rec-timer" id="app-rec-timer">0:00</span><span style="flex:1;font-size:12px;color:var(--dim)">Gravando...</span><button class="app-audio-rec-stop">Parar</button>`;
    bar.querySelector("button").addEventListener("click", _appStopRecording);
    composer.parentNode.insertBefore(bar, composer);
    [$("composer-input"),$("send-btn"),$("app-attach-btn")].forEach(el => { if (el) el.disabled = true; });
  }

  function _appShowPreview(blob) {
    _appRemoveBars();
    const url = URL.createObjectURL(blob);
    const composer = document.querySelector(".composer");
    if (!composer) return;
    const bar = document.createElement("div");
    bar.id = "app-audio-preview-bar";
    bar.className = "app-audio-preview-bar";
    bar.innerHTML = `<audio controls src="${url}" style="flex:1;height:34px;min-width:0"></audio><button class="app-audio-preview-cancel">Cancelar</button><button class="app-audio-preview-send">Enviar</button>`;
    bar.querySelector(".app-audio-preview-cancel").addEventListener("click", () => {
      URL.revokeObjectURL(url); _appRemoveBars(); _appReenableComposer();
    });
    bar.querySelector(".app-audio-preview-send").addEventListener("click", async () => {
      URL.revokeObjectURL(url); _appRemoveBars();
      await _appSendBlob(blob);
      _appReenableComposer();
    });
    composer.parentNode.insertBefore(bar, composer);
  }

  function _appRemoveBars() {
    document.getElementById("app-audio-rec-bar")?.remove();
    document.getElementById("app-audio-preview-bar")?.remove();
  }

  function _appReenableComposer() {
    const c = byId[currentChat];
    const manual = c?.bot_paused;
    const closed = manual && windowClosed(c);
    [$("composer-input"),$("send-btn"),$("app-attach-btn"),$("app-mic-btn")].forEach(el => {
      if (el) el.disabled = !manual || closed;
    });
  }

  async function _appSendBlob(blob) {
    if (!sb || !currentChat) return;
    const micBtn = $("app-mic-btn");
    if (micBtn) micBtn.disabled = true;
    try {
      const baseMime = blob.type.split(";")[0];
      const ext = _appAudioExt(baseMime);
      const path = `crm/audio-${Date.now()}-${(currentChat||"").slice(-8)}.${ext}`;
      const { error: upErr } = await sb.storage.from("whatsapp-media").upload(path, blob, { contentType: baseMime, upsert: false });
      if (upErr) throw new Error("Upload falhou: " + upErr.message);
      const { data: { publicUrl } } = sb.storage.from("whatsapp-media").getPublicUrl(path);
      const res = await authedFetch(`/api/admin/contacts/${encodeURIComponent(currentChat)}/messages`, {
        method: "POST",
        body: JSON.stringify({ mediaUrl: publicUrl, mediaType: "audio" }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const c = byId[currentChat];
      if (c) { c.bot_paused = true; updateChatHeader(c); updateBotControls(c); renderContacts(); }
      await loadMessages(currentChat, true);
    } catch (e) {
      toast(e.message || "Falha ao enviar áudio.");
    } finally {
      if (micBtn) micBtn.disabled = false;
    }
  }

  // ---------------- ENVIAR (atendente humano) ----------------
  async function sendMedia(file) {
    if (!file || !currentChat) return;
    if (!sb) { toast("Supabase não conectado — não é possível enviar arquivos."); return; }
    const attachBtn = $("app-attach-btn");
    const sendBtn = $("send-btn");
    if (attachBtn) { attachBtn.disabled = true; attachBtn.classList.add("loading"); }
    if (sendBtn) sendBtn.disabled = true;
    const mime = file.type;
    let mediaType = "document";
    if (mime.startsWith("image/")) mediaType = "image";
    else if (mime.startsWith("video/")) mediaType = "video";
    else if (mime.startsWith("audio/")) mediaType = "audio";
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `crm/${Date.now()}-${(currentChat || "").slice(-8)}.${ext}`;
      const { error: upErr } = await sb.storage.from("whatsapp-media").upload(path, file, { contentType: mime, upsert: false });
      if (upErr) throw new Error("Upload falhou: " + upErr.message);
      const { data: { publicUrl } } = sb.storage.from("whatsapp-media").getPublicUrl(path);
      const caption = $("composer-input").value.trim();
      const res = await authedFetch(`/api/admin/contacts/${encodeURIComponent(currentChat)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          mediaUrl: publicUrl,
          mediaType,
          caption: caption || undefined,
          filename: mediaType === "document" ? file.name : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Falha ao enviar."); return; }
      $("composer-input").value = "";
      autoGrow();
      const c = byId[currentChat] || { wa_id: currentChat };
      c.bot_paused = true;
      byId[currentChat] = c;
      updateChatHeader(c);
      updateBotControls(c);
      await loadMessages(currentChat);
    } catch (e) {
      toast(e.message || "Falha ao enviar arquivo.");
    } finally {
      if (attachBtn) { attachBtn.disabled = false; attachBtn.classList.remove("loading"); }
      const c = byId[currentChat];
      if (sendBtn) sendBtn.disabled = !c || !c.bot_paused;
      const fi = $("app-media-input");
      if (fi) fi.value = "";
    }
  }

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
    if (!ta.disabled) $("send-btn").classList.toggle("off", !ta.value.trim());
  }

  // ---------------- TEMA (claro/escuro do design) ----------------
  const ICON_MOON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12.3 3a9 9 0 1 0 8.7 11.3A7.2 7.2 0 0 1 12.3 3z"></path></svg>';
  const ICON_SUN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4.6"></circle><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"></path></g></svg>';
  function applyTheme(t) {
    const root = $("ideal-root");
    const dark = t === "dark";
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    const btn = $("theme-btn");
    if (btn) btn.innerHTML = dark ? ICON_SUN : ICON_MOON;
  }
  function toggleTheme() {
    const next = $("ideal-root").classList.contains("dark") ? "light" : "dark";
    localStorage.setItem("CRM_THEME", next);
    applyTheme(next);
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
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setBanner("Reconectando ao tempo real…");
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(subscribeRealtime, 3000); // reconecta sozinho
        }
      });
  }

  // Rede de segurança: o Realtime cai às vezes (app em background, troca de rede)
  // sem reconectar — e a mensagem só aparecia após F5. Re-busca a conversa aberta
  // (anexa só o que falta, dedup por id) ao voltar o foco e a cada 10s.
  async function refreshOpenChat() {
    if (!currentChat) return;
    try {
      const res = await authedFetch(`/api/admin/contacts/${encodeURIComponent(currentChat)}/messages?limit=50`);
      if (!res.ok) return;
      const data = await res.json();
      const box = $("messages");
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
      let added = false;
      for (const m of (data.messages || [])) {
        const el = buildMessageEl(m); // dedup por id — anexa só as novas
        if (el) { box.appendChild(el); added = true; }
      }
      if (added && nearBottom) scrollToBottom();
    } catch (e) { /* silencioso */ }
  }

  function startSafetyNet() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      loadContacts();    // atualiza a lista
      refreshOpenChat(); // e a conversa aberta
    });
    if (safetyTimer) clearInterval(safetyTimer);
    safetyTimer = setInterval(() => {
      if (!document.hidden) refreshOpenChat();
    }, 10000);
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
  $("login-btn").addEventListener("click", () => doLogin($("login-user").value.trim(), $("login-pass").value));
  $("login-user").addEventListener("keydown", (e) => { if (e.key === "Enter") $("login-pass").focus(); });
  $("login-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin($("login-user").value.trim(), $("login-pass").value);
  });
  $("chg-btn").addEventListener("click", async () => {
    $("chg-error").textContent = "";
    const np = $("chg-new").value, cf = $("chg-confirm").value;
    if (np.length < 6) { $("chg-error").textContent = "Mínimo 6 caracteres."; return; }
    if (np !== cf) { $("chg-error").textContent = "As senhas não conferem."; return; }
    try {
      await changePassword(np);
      currentUser.must_change_password = false;
      pendingPwd = "";
      await startApp();
    } catch (e) { $("chg-error").textContent = e.message; }
  });
  $("logout-btn").addEventListener("click", () => {
    localStorage.removeItem("CRM_TOKEN");
    if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
    location.reload();
  });
  $("notif-btn").addEventListener("click", enableNotifications);
  $("theme-btn").addEventListener("click", toggleTheme);
  // Drawer lateral
  const drawer = $("app-drawer");
  const drawerOverlay = $("drawer-overlay");
  function openDrawer() { drawer.classList.add("open"); drawerOverlay.classList.add("show"); }
  function closeDrawer() { drawer.classList.remove("open"); drawerOverlay.classList.remove("show"); }
  $("menu-btn").addEventListener("click", openDrawer);
  drawerOverlay.addEventListener("click", closeDrawer);
  $("drawer-conversas").addEventListener("click", closeDrawer);
  $("search-input").addEventListener("input", renderContacts);

  // Pull-to-refresh na lista: puxa pra baixo no topo -> recarrega contatos.
  (function initPullToRefresh() {
    const scroll = $("contacts-list");
    const spin = $("ptr-spin");
    if (!scroll || !spin) return;
    const p = { active: false, y: 0, pull: 0, busy: false };
    function render(v) {
      p.pull = v;
      spin.style.transition = v === 0 ? "transform .3s, opacity .3s" : "none";
      spin.style.transform = `translateX(-50%) translateY(${Math.max(-40, v - 40)}px) rotate(${v * 3}deg)`;
      spin.style.opacity = String(Math.min(1, v / 55));
      scroll.style.transition = v === 0 ? "transform .35s cubic-bezier(.25,1,.4,1)" : "none";
      scroll.style.transform = `translateY(${v}px)`;
    }
    scroll.addEventListener("pointerdown", (e) => {
      if (p.busy || scroll.scrollTop > 0) return;
      p.active = true; p.y = e.clientY;
    });
    scroll.addEventListener("pointermove", (e) => {
      if (!p.active || p.busy) return;
      const d = e.clientY - p.y;
      if (d > 0) render(Math.min(110, d * 0.45));
      else { p.active = false; render(0); }
    });
    async function end() {
      if (!p.active) return;
      p.active = false;
      if (p.pull > 62) {
        p.busy = true;
        spin.classList.add("spinning");
        spin.style.transition = "transform .25s, opacity .25s";
        spin.style.transform = "translateX(-50%) translateY(-14px)";
        spin.style.opacity = "1";
        scroll.style.transition = "transform .25s";
        scroll.style.transform = "translateY(26px)";
        try { await loadContacts(); } catch (_) {}
        p.busy = false;
        spin.classList.remove("spinning");
      }
      render(0);
    }
    scroll.addEventListener("pointerup", end);
    scroll.addEventListener("pointercancel", end);
  })();

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
  const attachBtn = $("app-attach-btn");
  const mediaInput = $("app-media-input");
  if (attachBtn && mediaInput) {
    attachBtn.addEventListener("click", () => mediaInput.click());
    mediaInput.addEventListener("change", () => { if (mediaInput.files?.[0]) sendMedia(mediaInput.files[0]); });
  }
  const micBtn = $("app-mic-btn");
  if (micBtn) micBtn.addEventListener("click", toggleAppAudioRecording);
  $("composer-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ---------------- BOOT ----------------
  async function boot() {
    applyTheme(localStorage.getItem("CRM_THEME") || "light");
    if (!token) { showScreen("login"); return; }
    // Valida o token salvo via /api/auth/me antes de entrar no app.
    const r = await fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } }).catch(() => null);
    if (!r || !r.ok) { localStorage.removeItem("CRM_TOKEN"); token = ""; showScreen("login"); return; }
    currentUser = (await r.json()).user;
    if (currentUser.must_change_password) { showScreen("change"); return; }
    await startApp();
  }
  if (window.supabase) boot();
  else window.addEventListener("load", boot);
})();
