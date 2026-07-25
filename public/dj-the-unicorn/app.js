(() => {
  "use strict";

  const STORE_KEY = "dj_unicorn_store_v1";
  const ADMIN_KEY = "dj_unicorn_admin_v1";
  const PRO_KEY = "dj_unicorn_pro_v1";
  const SESSION_KEY = "dj_unicorn_session_v1";
  const DB_NAME = "dj_unicorn_library_v1";
  const DB_STORE = "tracks";
  const DEMO_LIMIT = 3;
  const PRO_LAUNCH_LIMIT = 50;
  const OWNER_CODE = "Dientito2032";
  const VIZ_BINS = 48;

  const $ = (id) => document.getElementById(id);

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function defaultStore() {
    return {
      noticeOk: false,
      termsOk: false,
      email: "",
      name: "",
      last: "",
      pinHash: "",
      owner: false,
      pro: false,
      discountCode: "",
      lang: "es",
    };
  }
  function defaultAdmin() {
    return { proSoldCount: 0, buyers: [] };
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbClear() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const state = {
    store: loadJSON(STORE_KEY, defaultStore()),
    admin: loadJSON(ADMIN_KEY, defaultAdmin()),
    isPro: localStorage.getItem(PRO_KEY) === "1" || false,
    tracks: [],
    index: -1,
    wantPlaying: false,
    seeking: false,
    ctx: null,
    source: null,
    analyser: null,
    freqData: null,
    wired: false,
    vizSmooth: new Array(VIZ_BINS).fill(0.05),
    objectUrls: new Map(),
  };

  const audio = $("audio");
  const vizCanvas = $("vizCanvas");
  const vizCtx = vizCanvas.getContext("2d");

  function saveStore() {
    saveJSON(STORE_KEY, state.store);
  }
  function saveAdmin() {
    saveJSON(ADMIN_KEY, state.admin);
  }
  function isOwner() {
    return !!state.store.owner;
  }
  function getProPrice() {
    const sold = Number(state.admin.proSoldCount) || 0;
    return sold < PRO_LAUNCH_LIMIT ? 5 : 10;
  }
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function formatBytes(n) {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  }
  function showStatus(msg, err = false) {
    const el = $("statusMsg");
    el.textContent = msg;
    el.classList.toggle("error", !!err);
    el.classList.remove("hidden");
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(() => el.classList.add("hidden"), 3200);
  }
  function uid() {
    return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function upsertBuyer(partial) {
    const email = String(partial.email || "").toLowerCase();
    if (!email) return;
    const list = state.admin.buyers || [];
    const i = list.findIndex((b) => String(b.email || "").toLowerCase() === email);
    const prev = i >= 0 ? list[i] : {};
    const next = {
      ...prev,
      ...partial,
      email,
      updatedAt: Date.now(),
      joinedAt: prev.joinedAt || Date.now(),
    };
    if (i >= 0) list[i] = next;
    else list.push(next);
    state.admin.buyers = list;
    saveAdmin();
  }

  function currentBuyerBanned() {
    const email = String(state.store.email || "").toLowerCase();
    if (!email) return false;
    const b = (state.admin.buyers || []).find((x) => String(x.email || "").toLowerCase() === email);
    return !!(b && b.banned);
  }

  function objectUrlFor(track) {
    if (!track?.blob) return "";
    if (state.objectUrls.has(track.id)) return state.objectUrls.get(track.id);
    const url = URL.createObjectURL(track.blob);
    state.objectUrls.set(track.id, url);
    return url;
  }

  async function refreshStorageInfo() {
    const bytes = state.tracks.reduce((sum, t) => sum + (t.size || t.blob?.size || 0), 0);
    $("storageInfo").textContent = `Espacio local: ${formatBytes(bytes)} · ${state.tracks.length} tema(s)`;
    if (state.store.email) {
      upsertBuyer({
        email: state.store.email,
        name: state.store.name,
        last: state.store.last,
        storageBytes: bytes,
        pro: state.isPro || !!state.store.pro,
      });
    }
  }

  function renderPlaylist() {
    const ul = $("playlist");
    ul.innerHTML = "";
    $("trackCount").textContent = String(state.tracks.length);
    $("emptyHint").classList.toggle("hidden", state.tracks.length > 0);
    state.tracks.forEach((track, i) => {
      const li = document.createElement("li");
      if (i === state.index) li.classList.add("active");
      li.innerHTML = `<div class="t"><strong></strong><span></span></div><button class="del" type="button" aria-label="Borrar">✕</button>`;
      li.querySelector("strong").textContent = track.title;
      li.querySelector("span").textContent = `${track.ext || "audio"} · ${formatBytes(track.size || 0)}`;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".del")) return;
        playAt(i);
      });
      li.querySelector(".del").addEventListener("click", async (e) => {
        e.stopPropagation();
        await removeTrack(track.id);
      });
      ul.appendChild(li);
    });
    refreshStorageInfo();
  }

  async function removeTrack(id) {
    const i = state.tracks.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [removed] = state.tracks.splice(i, 1);
    if (state.objectUrls.has(id)) {
      URL.revokeObjectURL(state.objectUrls.get(id));
      state.objectUrls.delete(id);
    }
    await idbDelete(id);
    if (state.index === i) {
      audio.pause();
      setPlayingUI(false);
      state.index = Math.min(i, state.tracks.length - 1);
      if (state.index >= 0) await playAt(state.index, false);
      else {
        $("trackTitle").textContent = "Sin reproducción";
        $("trackSub").textContent = "Importá medios — se guardan solos";
      }
    } else if (state.index > i) {
      state.index -= 1;
    }
    renderPlaylist();
    showStatus(`Eliminado: ${removed.title}`);
  }

  async function clearLibrary() {
    for (const url of state.objectUrls.values()) URL.revokeObjectURL(url);
    state.objectUrls.clear();
    state.tracks = [];
    state.index = -1;
    audio.pause();
    audio.removeAttribute("src");
    setPlayingUI(false);
    await idbClear();
    renderPlaylist();
    showStatus("Biblioteca vaciada");
  }

  async function importFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(f.name));
    if (!files.length) {
      showStatus("No hay audio válido", true);
      return;
    }
    if (!state.isPro && !isOwner()) {
      const room = Math.max(0, DEMO_LIMIT - state.tracks.length);
      if (room <= 0) {
        showStatus("DEMO: máximo 3 canciones. Desbloqueá Pro.", true);
        openSheet("pro");
        return;
      }
      files.splice(room);
    }
    for (const file of files) {
      const id = uid();
      const title = file.name.replace(/\.[^.]+$/, "");
      const ext = (file.name.split(".").pop() || "audio").toLowerCase();
      const record = {
        id,
        title,
        ext,
        size: file.size,
        type: file.type || "audio/mpeg",
        blob: file,
        createdAt: Date.now(),
      };
      await idbPut(record);
      state.tracks.push(record);
    }
    renderPlaylist();
    showStatus(`Guardadas ${files.length} · quedan al cerrar la app`);
    if (state.index < 0 && state.tracks.length) playAt(0, false);
  }

  async function loadLibrary() {
    const rows = await idbAll();
    state.tracks = rows
      .filter((r) => r && r.blob)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    renderPlaylist();
    if (state.tracks.length) {
      $("trackSub").textContent = `${state.tracks.length} guardada(s) en este dispositivo`;
    }
  }

  function ensureAudioGraph() {
    if (state.wired) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      state.ctx = new Ctx();
      state.source = state.ctx.createMediaElementSource(audio);
      state.analyser = state.ctx.createAnalyser();
      state.analyser.fftSize = 512;
      state.analyser.smoothingTimeConstant = 0.45;
      state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
      state.source.connect(state.analyser);
      state.analyser.connect(state.ctx.destination);
      state.wired = true;
      return true;
    } catch (err) {
      console.warn(err);
      return false;
    }
  }

  async function resumeCtx() {
    if (!state.ctx) ensureAudioGraph();
    if (state.ctx?.state === "suspended") {
      try { await state.ctx.resume(); } catch { /* */ }
    }
  }

  function setPlayingUI(playing) {
    $("art").classList.toggle("playing", playing);
    $("iconPlay").classList.toggle("hidden", playing);
    $("iconPause").classList.toggle("hidden", !playing);
  }

  async function playAt(i, autoplay = true) {
    if (!state.tracks.length) return;
    const n = ((i % state.tracks.length) + state.tracks.length) % state.tracks.length;
    if (!state.isPro && !isOwner() && n >= DEMO_LIMIT) {
      showStatus("DEMO: solo 3 canciones", true);
      openSheet("pro");
      return;
    }
    state.index = n;
    const track = state.tracks[n];
    const url = objectUrlFor(track);
    ensureAudioGraph();
    await resumeCtx();
    audio.src = url;
    $("trackTitle").textContent = track.title;
    $("trackSub").textContent = `${track.ext} · ${formatBytes(track.size || 0)} · guardada`;
    renderPlaylist();
    if (autoplay) {
      state.wantPlaying = true;
      try {
        await audio.play();
        setPlayingUI(true);
      } catch {
        setPlayingUI(false);
        showStatus("Tocá play para empezar", true);
      }
    }
  }

  function sizeVizCanvas() {
    const rect = vizCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (vizCanvas.width !== w || vizCanvas.height !== h) {
      vizCanvas.width = w;
      vizCanvas.height = h;
    }
  }

  function drawViz() {
    sizeVizCanvas();
    const w = vizCanvas.width;
    const h = vizCanvas.height;
    const ctx = vizCtx;
    const playing = !audio.paused && state.analyser && state.freqData;

    if (playing) {
      state.analyser.getByteFrequencyData(state.freqData);
      const step = Math.max(1, Math.floor(state.freqData.length / VIZ_BINS));
      for (let i = 0; i < VIZ_BINS; i += 1) {
        const target = (state.freqData[Math.min(state.freqData.length - 1, i * step)] || 0) / 255;
        // Tight follow for beat sync
        state.vizSmooth[i] += (target - state.vizSmooth[i]) * 0.55;
      }
    } else {
      for (let i = 0; i < VIZ_BINS; i += 1) {
        state.vizSmooth[i] += (0.04 - state.vizSmooth[i]) * 0.08;
      }
    }

    ctx.fillStyle = "rgba(5,7,12,0.35)";
    ctx.fillRect(0, 0, w, h);
    const barW = w / VIZ_BINS;
    for (let i = 0; i < VIZ_BINS; i += 1) {
      const v = Math.max(0.03, state.vizSmooth[i]);
      const bh = v * h * 0.9;
      const x = i * barW + barW * 0.18;
      const g = ctx.createLinearGradient(0, h - bh, 0, h);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, "#3de0ff");
      g.addColorStop(1, "#7c6cff");
      ctx.fillStyle = g;
      ctx.fillRect(x, h - bh, barW * 0.64, bh);
    }
  }

  function tick() {
    drawViz();
    if (!state.seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
      $("seek").value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      $("timeCurrent").textContent = formatTime(audio.currentTime);
      $("timeTotal").textContent = formatTime(audio.duration);
    }
    requestAnimationFrame(tick);
  }

  function refreshProUI() {
    const price = getProPrice();
    state.isPro = isOwner() || state.isPro || !!state.store.pro || localStorage.getItem(PRO_KEY) === "1";
    $("demoBanner").textContent = isOwner()
      ? "Dueño · Pro activo"
      : (state.isPro
        ? "Pro activo · biblioteca ilimitada · fondo OK"
        : `DEMO · 3 canciones · Pro $${price} (primeros 50 a $5)`);
    $("btnMenuPro").textContent = state.isPro ? "Pro activo" : `Desbloquear Pro · $${price}`;
    $("btnAdminMenu").classList.toggle("hidden", !isOwner());
  }

  function openSheet(kind) {
    const body = $("sheetBody");
    const sheet = $("sheet");
    if (kind === "pro") {
      const price = getProPrice();
      const left = Math.max(0, PRO_LAUNCH_LIMIT - (Number(state.admin.proSoldCount) || 0));
      body.innerHTML = `
        <h3>DJ The Unicorn Pro — $${price}</h3>
        <p class="hint">Compra única. No es suscripción. Primeros 50 a $5 (${left} restantes), después $10. Quita límite DEMO y permite uso continuo.</p>
        <div class="pay-list">
          <button class="btn pay" data-pay="apple" type="button">Apple Pay · $${price}</button>
          <button class="btn pay" data-pay="card" type="button">Tarjeta · $${price}</button>
          <button class="btn pay" data-pay="paypal" type="button">PayPal · $${price}</button>
          <button class="btn pay" data-pay="mercadopago" type="button">Mercado Pago · $${price}</button>
        </div>
        <button class="btn soft" id="sheetClose" type="button">Cancelar</button>`;
      body.querySelectorAll("[data-pay]").forEach((btn) => {
        btn.addEventListener("click", () => unlockPro(btn.getAttribute("data-pay")));
      });
    } else if (kind === "account") {
      body.innerHTML = `
        <h3>Cuenta</h3>
        <p class="hint">${state.store.email || (isOwner() ? "Dueño" : "—")}</p>
        <p class="hint">${state.store.name || ""} ${state.store.last || ""}</p>
        <p class="hint">Pro: ${state.isPro ? "sí" : "no"} · Precio actual $${getProPrice()}</p>
        <button class="btn soft" id="sheetClose" type="button">Cerrar</button>`;
    } else if (kind === "admin") {
      const admin = state.admin;
      const left = Math.max(0, PRO_LAUNCH_LIMIT - (Number(admin.proSoldCount) || 0));
      body.innerHTML = `
        <h3>Admin dueño</h3>
        <p class="hint">Vendidos: <strong>${admin.proSoldCount || 0}</strong> · Restantes a $5: <strong>${left}</strong> · Precio actual: <strong>$${getProPrice()}</strong></p>
        <div id="buyerList" class="pay-list"></div>
        <button class="btn soft" id="sheetClose" type="button">Cerrar</button>`;
      const list = body.querySelector("#buyerList");
      (admin.buyers || []).slice().reverse().forEach((b) => {
        const card = document.createElement("div");
        card.className = "admin-buyer";
        card.innerHTML = `
          <div class="row"><strong></strong><span class="pill">${b.banned ? "BAN" : (b.pro ? "PRO" : "DEMO")}</span></div>
          <div class="hint"></div>
          <button class="btn ${b.banned ? "soft" : "solid"}" type="button"></button>`;
        card.querySelector("strong").textContent = b.email || "—";
        card.querySelector(".hint").textContent = `${b.name || ""} ${b.last || ""} · ${formatBytes(b.storageBytes || 0)} · pago $${b.pricePaid || "—"} · ${b.payMethod || "—"}`;
        const btn = card.querySelector("button");
        btn.textContent = b.banned ? "Quitar ban" : "Banear";
        btn.addEventListener("click", () => {
          upsertBuyer({ email: b.email, banned: !b.banned });
          if (!b.banned && String(state.store.email || "").toLowerCase() === String(b.email || "").toLowerCase()) {
            showStatus("Usuario baneado", true);
            lockApp();
          }
          openSheet("admin");
        });
        list.appendChild(card);
      });
      if (!(admin.buyers || []).length) {
        list.innerHTML = `<p class="hint">Sin compradores registrados aún (local en este dispositivo).</p>`;
      }
    }
    body.querySelector("#sheetClose")?.addEventListener("click", () => sheet.close());
    sheet.showModal();
  }

  async function unlockPro(method) {
    $("sheet").close();
    if (isOwner()) {
      state.isPro = true;
      localStorage.setItem(PRO_KEY, "1");
      refreshProUI();
      showStatus("Pro OK (dueño)");
      return;
    }
    const price = getProPrice();
    const email = String(state.store.email || "").toLowerCase();
    const already = (state.admin.buyers || []).find((b) => String(b.email || "").toLowerCase() === email && b.pro);
    if (!already) {
      state.admin.proSoldCount = (Number(state.admin.proSoldCount) || 0) + 1;
      saveAdmin();
    }
    state.isPro = true;
    state.store.pro = true;
    localStorage.setItem(PRO_KEY, "1");
    saveStore();
    if (email) {
      upsertBuyer({
        email,
        pro: true,
        pricePaid: already?.pricePaid ?? price,
        payMethod: method || "local",
        storageBytes: state.tracks.reduce((s, t) => s + (t.size || 0), 0),
      });
    }
    refreshProUI();
    showStatus(`Pro vía ${method || "local"} · $${already?.pricePaid ?? price}`);
  }

  function showGate(id) {
    ["gateNotice", "gateAccount", "gateOwner", "gateUnlock"].forEach((key) => {
      $(key).classList.toggle("hidden", key !== id);
    });
    $("gate").classList.remove("hidden");
    $("appRoot").classList.add("hidden");
  }

  function enterApp() {
    if (currentBuyerBanned()) {
      showStatus("Cuenta baneada", true);
      showGate("gateUnlock");
      return;
    }
    $("gate").classList.add("hidden");
    $("appRoot").classList.remove("hidden");
    sessionStorage.setItem(SESSION_KEY, "1");
    refreshProUI();
    loadLibrary();
  }

  function lockApp() {
    sessionStorage.removeItem(SESSION_KEY);
    audio.pause();
    setPlayingUI(false);
    if (state.store.email || isOwner()) showGate("gateUnlock");
    else showGate("gateNotice");
  }

  function bootGate() {
    $("unlockEmail").textContent = state.store.email || (isOwner() ? "Dueño" : "");
    if (sessionStorage.getItem(SESSION_KEY) === "1" && (state.store.email || isOwner())) {
      enterApp();
      return;
    }
    if (state.store.email || isOwner()) showGate("gateUnlock");
    else showGate("gateNotice");
  }

  // —— Events ——
  const syncNotice = () => {
    $("btnNoticeContinue").disabled = !($("noticeAccept").checked && $("termsAccept").checked);
  };
  $("noticeAccept").addEventListener("change", syncNotice);
  $("termsAccept").addEventListener("change", syncNotice);
  $("btnNoticeContinue").addEventListener("click", () => {
    state.store.noticeOk = true;
    state.store.termsOk = true;
    saveStore();
    showGate("gateAccount");
  });
  $("btnBackNotice").addEventListener("click", () => showGate("gateNotice"));
  $("btnOwnerFromNotice").addEventListener("click", () => showGate("gateOwner"));
  $("btnOwnerBack").addEventListener("click", () => showGate("gateNotice"));

  $("btnCreateAccount").addEventListener("click", async () => {
    const email = $("accEmail").value.trim().toLowerCase();
    const name = $("accName").value.trim();
    const last = $("accLast").value.trim();
    const pin = $("accPin").value;
    if (!email || !email.includes("@") || pin.length < 4) {
      showStatus("Email y PIN (4+) requeridos", true);
      return;
    }
    state.store.email = email;
    state.store.name = name;
    state.store.last = last;
    state.store.pinHash = await sha256(`pin:${email}:${pin}`);
    state.store.discountCode = `UNICORN-${email.slice(0, 3).toUpperCase()}${String(Date.now()).slice(-4)}`;
    saveStore();
    upsertBuyer({ email, name, last, pro: false, storageBytes: 0 });
    enterApp();
  });

  $("btnOwnerUnlock").addEventListener("click", async () => {
    const code = $("ownerCode").value;
    const hash = await sha256(`dj-unicorn-owner:${OWNER_CODE}`);
    const tryHash = await sha256(`dj-unicorn-owner:${code}`);
    if (tryHash !== hash && code !== OWNER_CODE) {
      showStatus("Código incorrecto", true);
      return;
    }
    state.store.owner = true;
    state.isPro = true;
    localStorage.setItem(PRO_KEY, "1");
    saveStore();
    enterApp();
  });

  $("btnUnlock").addEventListener("click", async () => {
    if (isOwner()) {
      enterApp();
      return;
    }
    const pin = $("unlockSecret").value;
    const hash = await sha256(`pin:${state.store.email}:${pin}`);
    if (hash !== state.store.pinHash) {
      showStatus("PIN incorrecto", true);
      return;
    }
    enterApp();
  });

  $("btnMenu").addEventListener("click", () => {
    $("menuDrawer").classList.remove("hidden");
    refreshProUI();
  });
  $("btnCloseMenu").addEventListener("click", () => $("menuDrawer").classList.add("hidden"));
  $("menuBackdrop").addEventListener("click", () => $("menuDrawer").classList.add("hidden"));
  $("btnLockNow").addEventListener("click", () => {
    $("menuDrawer").classList.add("hidden");
    lockApp();
  });
  document.querySelectorAll(".menu-link[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("menuDrawer").classList.add("hidden");
      openSheet(btn.getAttribute("data-go"));
    });
  });

  $("btnImportFiles").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", async () => {
    await importFiles($("fileInput").files || []);
    $("fileInput").value = "";
  });
  $("btnClear").addEventListener("click", () => clearLibrary());

  $("btnPlay").addEventListener("click", async () => {
    if (!state.tracks.length) {
      showStatus("Importá canciones primero", true);
      return;
    }
    ensureAudioGraph();
    await resumeCtx();
    if (audio.paused) {
      if (state.index < 0) await playAt(0);
      else {
        state.wantPlaying = true;
        try { await audio.play(); setPlayingUI(true); } catch { showStatus("No se pudo reproducir", true); }
      }
    } else {
      audio.pause();
      state.wantPlaying = false;
      setPlayingUI(false);
    }
  });
  $("btnPrev").addEventListener("click", () => { if (state.tracks.length) playAt(state.index - 1); });
  $("btnNext").addEventListener("click", () => { if (state.tracks.length) playAt(state.index + 1); });

  $("seek").addEventListener("pointerdown", () => { state.seeking = true; });
  $("seek").addEventListener("pointerup", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (Number($("seek").value) / 1000) * audio.duration;
    }
    state.seeking = false;
  });

  audio.addEventListener("ended", () => {
    if (state.tracks.length) playAt(state.index + 1);
  });
  audio.addEventListener("play", () => setPlayingUI(true));
  audio.addEventListener("pause", () => setPlayingUI(false));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !state.isPro && !isOwner() && state.wantPlaying) {
      audio.pause();
      setPlayingUI(false);
      showStatus("DEMO: solo primer plano", true);
    }
  });

  window.addEventListener("resize", sizeVizCanvas);
  refreshProUI();
  bootGate();
  sizeVizCanvas();
  requestAnimationFrame(tick);
})();
