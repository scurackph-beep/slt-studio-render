(() => {
  const STORE_KEY = "sweet_deck_store_v2";
  const PRO_KEY = "sweet_deck_pro_v1";
  const SESSION_KEY = "sweet_deck_unlocked_v1";
  const ADMIN_KEY = "sweet_deck_admin_v1";
  const MEDIA_DB = "sweet_deck_media_v1";
  const MEDIA_STORE = "media";
  const DEMO = { songs: 3, karaoke: 1, lyrics: 1, videos: 1 };
  const PRO_LAUNCH_PRICE = 5;
  const PRO_STANDARD_PRICE = 10;
  const PRO_LAUNCH_LIMIT = 50;
  // Hash of site gate secret (sweetdeck-owner:…) — never shown in UI copy
  const OWNER_HASH = "5c7091cba469881a345b8f13acf203534363b046c56ce3304fe56a8c91e39278";
  // Public IPs that auto-enter as Pro owner (no code UI). Persist store.owner after match.
  const OWNER_IPS = [
    "38.86.152.136",
  ];

  const I18N = {
    es: {
      noticeTitle: "Antes de empezar",
      noticeNoSub: "Esto no es una suscripción.",
      noticeNoAds: "Hoy no tiene publicidad. En el futuro podría tenerla; te avisaremos en la app.",
      noticeDemo: "La DEMO es de uso limitado: 3 canciones, 1 karaoke, 1 letra, 1 video, y reproducción solo en primer plano.",
      noticeAccount: "Debes crear una cuenta. Ese email sirve para el universo Sweet Little Trauma.",
      noticeCode: "Por tener la app recibes un código 10% ligado a tu email (Studio, merch y futuros productos).",
      noticeAccept: "Acepto el aviso",
      termsAccept: "Acepto Bases y Condiciones",
      continue: "Continuar",
      back: "Volver",
      ownerEntry: "Soy el dueño",
      ownerTitle: "Acceso dueño",
      ownerHint: "Entra sin crear cuenta. Este dispositivo quedará en modo dueño (Pro).",
      ownerCode: "Código",
      ownerEnter: "Entrar como dueño",
      ownerBanner: "Dueño · Pro · sin límites DEMO",
      ownerAccount: "Modo dueño en este dispositivo",
      accountTitle: "Crear cuenta",
      firstName: "Nombre",
      lastName: "Apellido",
      email: "Email",
      phone: "Teléfono",
      country: "País",
      password: "Clave",
      passwordConfirm: "Confirmar",
      createAccount: "Crear cuenta",
      haveAccount: "Ya tengo cuenta",
      loginTitle: "Entrar",
      login: "Entrar",
      rewardTitle: "Tu código 10%",
      rewardHint: "Asociado a tu email. Se aplica automáticamente en el universo Sweet Little Trauma.",
      copyCode: "Copiar",
      secureTitle: "Protege la app",
      pin: "PIN (4–8)",
      pinConfirm: "Confirmar PIN",
      enableBio: "Face ID / huella",
      saveContinue: "Guardar y entrar",
      skipForNow: "Ahora no",
      unlockTitle: "Desbloquear",
      pinOrPass: "PIN o clave",
      unlock: "Desbloquear",
      useBio: "Face ID / Huella",
      lock: "Bloquear",
      tabDeck: "Deck",
      tabLists: "Listas",
      tabKaraoke: "Karaoke",
      tabVideo: "Video",
      tabRadio: "Radio",
      tabRecord: "Grabar",
      noPlayback: "Sin reproducción",
      importHint: "Importa medios para empezar",
      addMedia: "Añadir",
      folder: "Carpeta",
      playlist: "Cola",
      clear: "Vaciar",
      emptyList: "Vacía",
      equalizer: "Ecualizador",
      playlists: "Listas de reproducción",
      createList: "Crear",
      listHint: "Crea listas y añade temas desde la cola.",
      savedLibrary: "Biblioteca guardada",
      savedLibraryHint: "Grabaciones de voz/video y videos importados se guardan en este dispositivo y vuelven al reiniciar.",
      savedEmpty: "Sin medios guardados",
      savedBadge: "GUARDADO",
      savedOk: "Guardado en el dispositivo",
      vocalCut: "Atenuar voz",
      detectLyrics: "Letras",
      lyricsHere: "Las letras aparecerán aquí",
      noVideo: "Sin video",
      openVideo: "Abrir",
      useFromList: "De la cola",
      comingSoon: "PRÓXIMAMENTE",
      radioSoonHint: "Sintonizador y circuito cerrado Sweet Little Trauma llegarán en una próxima versión.",
      recAudio: "Voz",
      recVideo: "Video",
      stopSave: "Detener y guardar",
      menu: "Menú",
      settings: "Ajustes",
      account: "Cuenta",
      contact: "Contacto",
      legal: "Bases y condiciones",
      unlockPro: "Desbloquear Pro",
      proTitle: "Sweet Deck Pro",
      proHint: "Compra única. No es suscripción. Los primeros 50 Pro cuestan $5; después $10. Quita límites DEMO y permite audio en segundo plano.",
      cancel: "Cancelar",
      payNow: "Pagar",
      payMethods: "Elegí cómo pagar",
      payApple: "Apple Pay",
      payCard: "Tarjeta",
      payPaypal: "PayPal",
      payMercado: "Mercado Pago",
      payConfirm: "Confirmar pago",
      payLocalNote: "Pago seguro en la app. Compra única — no es suscripción.",
      demoBanner: "DEMO limitada: 3 canciones · 1 karaoke · 1 letra · 1 video · solo primer plano",
      proBanner: "Pro activo · sin límites DEMO · audio en segundo plano",
      admin: "Admin dueño",
      adminStats: "Estadísticas Pro",
      adminSold: "Vendidos",
      adminPriceNow: "Precio actual",
      adminRemaining5: "Restantes a $5",
      adminBuyers: "Compradores / cuentas",
      adminEmpty: "Sin registros aún",
      adminBan: "Banear",
      adminUnban: "Quitar ban",
      adminBanned: "BANEADO",
      adminStorage: "Almacenamiento",
      adminDeviceStorage: "Este dispositivo",
      adminSyncNote: "Registro local en este dispositivo. La sincronización multi-dispositivo requiere backend.",
      bannedTitle: "Acceso suspendido",
      bannedHint: "Esta cuenta fue suspendida por Sweet Little Trauma. Contactá soporte si creés que es un error.",
      bannedContact: "Contactar soporte",
    },
    en: {
      noticeTitle: "Before you start",
      noticeNoSub: "This is not a subscription.",
      noticeNoAds: "No advertising today. Ads may appear later; we will notify you in-app.",
      noticeDemo: "DEMO is limited: 3 songs, 1 karaoke, 1 lyrics fetch, 1 video, foreground playback only.",
      noticeAccount: "You must create an account. That email works across the Sweet Little Trauma universe.",
      noticeCode: "For having the app you get a 10% code tied to your email (Studio, merch, future products).",
      noticeAccept: "I accept this notice",
      termsAccept: "I accept Terms & Conditions",
      continue: "Continue",
      back: "Back",
      ownerEntry: "I am the owner",
      ownerTitle: "Owner access",
      ownerHint: "Enter without creating an account. This device will stay in owner mode (Pro).",
      ownerCode: "Code",
      ownerEnter: "Enter as owner",
      ownerBanner: "Owner · Pro · no DEMO limits",
      ownerAccount: "Owner mode on this device",
      accountTitle: "Create account",
      firstName: "First name",
      lastName: "Last name",
      email: "Email",
      phone: "Phone",
      country: "Country",
      password: "Password",
      passwordConfirm: "Confirm",
      createAccount: "Create account",
      haveAccount: "I already have an account",
      loginTitle: "Sign in",
      login: "Sign in",
      rewardTitle: "Your 10% code",
      rewardHint: "Linked to your email. Applied automatically across Sweet Little Trauma.",
      copyCode: "Copy",
      secureTitle: "Protect the app",
      pin: "PIN (4–8)",
      pinConfirm: "Confirm PIN",
      enableBio: "Face ID / fingerprint",
      saveContinue: "Save and enter",
      skipForNow: "Not now",
      unlockTitle: "Unlock",
      pinOrPass: "PIN or password",
      unlock: "Unlock",
      useBio: "Face ID / Fingerprint",
      lock: "Lock",
      tabDeck: "Deck",
      tabLists: "Lists",
      tabKaraoke: "Karaoke",
      tabVideo: "Video",
      tabRadio: "Radio",
      tabRecord: "Record",
      noPlayback: "Nothing playing",
      importHint: "Import media to start",
      addMedia: "Add",
      folder: "Folder",
      playlist: "Queue",
      clear: "Clear",
      emptyList: "Empty",
      equalizer: "Equalizer",
      playlists: "Playlists",
      createList: "Create",
      listHint: "Create lists and add tracks from the queue.",
      savedLibrary: "Saved library",
      savedLibraryHint: "Voice/video recordings and imported videos are stored on this device and restore after restart.",
      savedEmpty: "No saved media",
      savedBadge: "SAVED",
      savedOk: "Saved on device",
      vocalCut: "Attenuate vocals",
      detectLyrics: "Lyrics",
      lyricsHere: "Lyrics will appear here",
      noVideo: "No video",
      openVideo: "Open",
      useFromList: "From queue",
      comingSoon: "COMING SOON",
      radioSoonHint: "Tuner and Sweet Little Trauma closed circuit arrive in a future update.",
      recAudio: "Voice",
      recVideo: "Video",
      stopSave: "Stop and save",
      menu: "Menu",
      settings: "Settings",
      account: "Account",
      contact: "Contact",
      legal: "Terms & conditions",
      unlockPro: "Unlock Pro",
      proTitle: "Sweet Deck Pro",
      proHint: "One-time purchase. Not a subscription. First 50 Pro unlocks are $5; then $10. Removes DEMO limits and enables background audio.",
      cancel: "Cancel",
      payNow: "Pay",
      payMethods: "Choose payment",
      payApple: "Apple Pay",
      payCard: "Card",
      payPaypal: "PayPal",
      payMercado: "Mercado Pago",
      payConfirm: "Confirm payment",
      payLocalNote: "Secure in-app checkout. One-time purchase — not a subscription.",
      demoBanner: "Limited DEMO: 3 songs · 1 karaoke · 1 lyrics · 1 video · foreground only",
      proBanner: "Pro active · no DEMO limits · background audio",
      admin: "Owner admin",
      adminStats: "Pro stats",
      adminSold: "Sold",
      adminPriceNow: "Current price",
      adminRemaining5: "Left at $5",
      adminBuyers: "Buyers / accounts",
      adminEmpty: "No records yet",
      adminBan: "Ban",
      adminUnban: "Unban",
      adminBanned: "BANNED",
      adminStorage: "Storage",
      adminDeviceStorage: "This device",
      adminSyncNote: "Local registry on this device. Multi-device sync needs a backend.",
      bannedTitle: "Access suspended",
      bannedHint: "This account was suspended by Sweet Little Trauma. Contact support if you believe this is an error.",
      bannedContact: "Contact support",
    },
  };

  const LEGAL_HTML = {
    es: `
<p><strong>Bases y Condiciones — Sweet Deck</strong><br/>By Sweet Little Trauma / Sweet Little Trauma LLC (“la Compañía”).</p>
<p>1. <strong>Aceptación.</strong> Al usar Sweet Deck aceptás estas Bases. Si no estás de acuerdo, no uses la app.</p>
<p>2. <strong>No es suscripción.</strong> El acceso DEMO y/o la compra Pro (si aplica) no constituyen una suscripción periódica, salvo que la Compañía lo indique expresamente en el futuro.</p>
<p>3. <strong>DEMO limitada.</strong> La versión DEMO puede restringir cantidad de archivos, karaoke, letras, video y reproducción en segundo plano. La Compañía puede modificar, ampliar o reducir esos límites en cualquier momento.</p>
<p>4. <strong>Publicidad.</strong> Hoy puede no haber publicidad. La Compañía se reserva el derecho de incorporar publicidad, patrocinios o contenidos promocionales en cualquier momento, con aviso en la app cuando lo estime conveniente.</p>
<p>5. <strong>Cuenta y datos.</strong> Debés crear una cuenta con datos veraces. El email integra el universo Sweet Little Trauma. Autorizás a la Compañía a almacenar y usar esos datos para operar el servicio, seguridad, soporte, analítica, comunicación comercial y mejoras del producto, conforme su política de privacidad vigente.</p>
<p>6. <strong>Código de descuento.</strong> El código del 10% está asociado a tu email. Es personal, intransferible salvo autorización expresa, y su aplicación automática o manual queda a sola discreción de la Compañía. Puede limitarse, suspenderse o revocarse por fraude, abuso, error o cambio de campaña. No genera derecho adquirido ni saldo reembolsable.</p>
<p>7. <strong>Pro.</strong> Si existe compra Pro, es de pago único según el precio mostrado al momento de la compra. Los primeros 50 desbloqueos Pro se ofrecen a USD 5; a partir del número 51 el precio es USD 10, salvo que la Compañía publique otra oferta. Salvo obligación legal imperativa, no es reembolsable. Pro desbloquea funciones según la oferta vigente, que la Compañía puede actualizar. La Compañía puede suspender o banear cuentas por abuso, fraude o incumplimiento.</p>
<p>8. <strong>Contenidos del usuario.</strong> Sos el único responsable de los archivos que importás, grabás o reproducís y de contar con todos los derechos. La Compañía no otorga licencias sobre música/video de terceros. Otorgás a la Compañía una licencia mundial, no exclusiva y gratuita para procesar técnicamente esos contenidos solo a los fines de prestar el servicio en tu dispositivo.</p>
<p>9. <strong>Disponibilidad.</strong> El servicio se ofrece “tal cual” y “según disponibilidad”. La Compañía no garantiza funcionamiento ininterrumpido, APIs externas de letras/radio, ni compatibilidad con todos los dispositivos/Bluetooth.</p>
<p>10. <strong>Limitación de responsabilidad.</strong> En la máxima medida permitida por ley, la Compañía no responde por daños indirectos, lucro cesante, pérdida de datos o reclamos de terceros por derechos de autor derivados de tu uso.</p>
<p>11. <strong>Suspensión.</strong> La Compañía puede suspender o cancelar accesos, códigos o cuentas ante incumplimiento, riesgo de seguridad o requerimiento legal.</p>
<p>12. <strong>Cambios.</strong> Estas Bases pueden actualizarse. El uso continuado implica aceptación de la versión publicada en la app.</p>
<p>13. <strong>Ley y foro.</strong> Se rigen por las leyes aplicables al domicilio de Sweet Little Trauma LLC, sin perjuicio de normas imperativas de consumo. Controversias: jurisdicción de los tribunales competentes de ese domicilio, salvo norma imperativa en contrario.</p>
<p>Contacto: info@studiosweetlittletrauma.com</p>
`,
    en: `
<p><strong>Terms & Conditions — Sweet Deck</strong><br/>By Sweet Little Trauma / Sweet Little Trauma LLC (“Company”).</p>
<p>1. <strong>Acceptance.</strong> By using Sweet Deck you accept these Terms. If you disagree, do not use the app.</p>
<p>2. <strong>Not a subscription.</strong> DEMO access and/or Pro purchase (if any) are not a recurring subscription unless Company expressly states otherwise later.</p>
<p>3. <strong>Limited DEMO.</strong> DEMO may limit files, karaoke, lyrics, video and background playback. Company may change those limits at any time.</p>
<p>4. <strong>Advertising.</strong> There may be no ads today. Company may add advertising, sponsorships or promotional content at any time, with in-app notice when it deems appropriate.</p>
<p>5. <strong>Account & data.</strong> You must create an account with accurate data. Your email is part of the Sweet Little Trauma universe. You authorize Company to store and use that data to operate the service, security, support, analytics, commercial communications and product improvement under the then-current privacy policy.</p>
<p>6. <strong>Discount code.</strong> The 10% code is tied to your email, personal and non-transferable unless expressly allowed. Automatic/manual application is at Company’s sole discretion and may be limited, suspended or revoked for fraud, abuse, error or campaign changes. It creates no vested right or refundable balance.</p>
<p>7. <strong>Pro.</strong> If offered, Pro is a one-time purchase at the price shown at checkout. The first 50 Pro unlocks are USD 5; from number 51 onward the price is USD 10 unless Company publishes another offer. Except where mandatory law requires, it is non-refundable. Features follow the then-current offer, which Company may update. Company may suspend or ban accounts for abuse, fraud or breach.</p>
<p>8. <strong>User content.</strong> You alone are responsible for imported/recorded/played files and for all rights. Company grants no license to third-party media. You grant Company a worldwide, non-exclusive, royalty-free license to technically process such content solely to provide the on-device service.</p>
<p>9. <strong>Availability.</strong> Service is provided “as is” and “as available.” No warranty of uninterrupted operation, external lyrics/radio APIs, or universal device/Bluetooth compatibility.</p>
<p>10. <strong>Limitation of liability.</strong> To the fullest extent permitted by law, Company is not liable for indirect damages, lost profits, data loss, or third-party copyright claims arising from your use.</p>
<p>11. <strong>Suspension.</strong> Company may suspend or terminate access, codes or accounts for breach, security risk or legal requirement.</p>
<p>12. <strong>Changes.</strong> Terms may be updated. Continued use means acceptance of the version shown in the app.</p>
<p>13. <strong>Law & venue.</strong> Governed by laws applicable to Sweet Little Trauma LLC’s domicile, without prejudice to mandatory consumer rules. Disputes: courts of that domicile unless mandatory law provides otherwise.</p>
<p>Contact: info@studiosweetlittletrauma.com</p>
`,
  };

  const BANDS = [
    { freq: 60, type: "lowshelf", label: "60" },
    { freq: 230, type: "peaking", label: "230" },
    { freq: 910, type: "peaking", label: "910" },
    { freq: 3600, type: "peaking", label: "3.6k" },
    { freq: 14000, type: "highshelf", label: "14k" },
  ];
  const PRESETS = {
    flat: [0, 0, 0, 0, 0], bass: [7, 4, 0, -1, 0], voice: [-2, 1, 4, 3, 0],
    electronic: [5, 3, -1, 2, 4], rock: [4, 2, -1, 2, 3], soft: [2, 1, 0, -2, -3],
  };
  const MEDIA_RE = /\.(mp3|wav|wave|m4a|aac|flac|ogg|oga|mp4|mov|m4v|webm|aiff|aif|caf|wma)$/i;
  const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;

  const $ = (id) => document.getElementById(id);
  const loadStore = () => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch { return {}; }
  };
  const defaultAdmin = () => ({
    proSoldCount: 0,
    buyers: [],
    bans: [],
    updatedAt: Date.now(),
  });
  const loadAdmin = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(ADMIN_KEY) || "null");
      if (!raw || typeof raw !== "object") return defaultAdmin();
      return {
        ...defaultAdmin(),
        ...raw,
        buyers: Array.isArray(raw.buyers) ? raw.buyers : [],
        bans: Array.isArray(raw.bans) ? raw.bans : [],
        proSoldCount: Number(raw.proSoldCount) || 0,
      };
    } catch {
      return defaultAdmin();
    }
  };
  const saveAdmin = (admin) => {
    const next = {
      ...defaultAdmin(),
      ...admin,
      buyers: Array.isArray(admin.buyers) ? admin.buyers : [],
      bans: Array.isArray(admin.bans) ? admin.bans : [],
      proSoldCount: Number(admin.proSoldCount) || 0,
      updatedAt: Date.now(),
    };
    localStorage.setItem(ADMIN_KEY, JSON.stringify(next));
    // Mirror into owner store for future server sync shape
    if (state?.store) {
      state.store.admin = {
        proSoldCount: next.proSoldCount,
        bans: [...next.bans],
        buyers: next.buyers.map((b) => ({ ...b })),
        updatedAt: next.updatedAt,
      };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state.store)); } catch { /* ignore */ }
    }
    return next;
  };

  const state = {
    lang: "es",
    store: loadStore(),
    tracks: [],
    index: -1,
    seeking: false,
    ctx: null,
    source: null,
    filters: [],
    analyser: null,
    karaokeNode: null,
    freqData: null,
    gains: [0, 0, 0, 0, 0],
    wired: false,
    eqOn: false,
    karaoke: false,
    statusTimer: null,
    lyrics: [],
    lyricIndex: -1,
    isPro: localStorage.getItem(PRO_KEY) === "1" || !!loadStore().owner,
    wantPlaying: false,
    vinylAngle: 0,
    vinylSpeed: 0,
    vizSmooth: [],
    shuffle: false,
    repeat: "off", // off | one | all
    order: [],
    recorder: null,
    recChunks: [],
    recStream: null,
    recStarted: 0,
    recTimerId: null,
    usage: { karaoke: 0, lyrics: 0, videos: 0 },
  };
  state.usage = state.store.usage || state.usage;

  const audio = $("audio");
  audio.volume = 1;
  const canvas = $("vinylCanvas");
  const ctx2d = canvas.getContext("2d");
  const vizCanvas = $("vizCanvas");
  const vizCtx = vizCanvas.getContext("2d");
  const VIZ_BINS = 64;
  state.vizSmooth = new Array(VIZ_BINS).fill(0.04);
  let vizIdlePhase = 0;

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
  sizeVizCanvas();
  window.addEventListener("resize", sizeVizCanvas);

  // Pre-render vinyl disc texture once
  const disc = document.createElement("canvas");
  disc.width = 640; disc.height = 640;
  const dctx = disc.getContext("2d");
  {
    const g = dctx.createRadialGradient(320, 320, 20, 320, 320, 310);
    g.addColorStop(0, "#111");
    g.addColorStop(1, "#050505");
    dctx.fillStyle = g;
    dctx.beginPath(); dctx.arc(320, 320, 310, 0, Math.PI * 2); dctx.fill();
    for (let r = 70; r < 300; r += 2.2) {
      dctx.strokeStyle = `rgba(255,255,255,${0.02 + (r % 7 === 0 ? 0.03 : 0)})`;
      dctx.lineWidth = 1;
      dctx.beginPath(); dctx.arc(320, 320, r, 0, Math.PI * 2); dctx.stroke();
    }
    const shine = dctx.createLinearGradient(80, 80, 520, 520);
    shine.addColorStop(0, "rgba(255,255,255,0.18)");
    shine.addColorStop(0.35, "rgba(255,255,255,0)");
    shine.addColorStop(1, "rgba(255,255,255,0.05)");
    dctx.fillStyle = shine;
    dctx.beginPath(); dctx.arc(320, 320, 300, 0, Math.PI * 2); dctx.fill();
  }

  function saveStore() {
    state.store.usage = state.usage;
    localStorage.setItem(STORE_KEY, JSON.stringify(state.store));
  }

  function getProSoldCount() {
    return Number(loadAdmin().proSoldCount) || 0;
  }
  function getProPrice() {
    return getProSoldCount() < PRO_LAUNCH_LIMIT ? PRO_LAUNCH_PRICE : PRO_STANDARD_PRICE;
  }
  function remainingLaunchSlots() {
    return Math.max(0, PRO_LAUNCH_LIMIT - getProSoldCount());
  }
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  async function computeLocalStorageBytes() {
    try {
      const rows = await mediaAll();
      return rows.reduce((sum, row) => sum + (Number(row.size) || row.blob?.size || 0), 0);
    } catch {
      return 0;
    }
  }
  function isEmailBanned(email) {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return false;
    const admin = loadAdmin();
    if (admin.bans.map((e) => String(e).toLowerCase()).includes(key)) return true;
    return admin.buyers.some((b) => String(b.email || "").toLowerCase() === key && b.banned);
  }
  function upsertBuyer( partial = {}) {
    const email = String(partial.email || state.store.email || "").trim().toLowerCase();
    if (!email) return null;
    const admin = loadAdmin();
    const idx = admin.buyers.findIndex((b) => String(b.email || "").toLowerCase() === email);
    const prev = idx >= 0 ? admin.buyers[idx] : {};
    const nextBuyer = {
      email,
      firstName: partial.firstName ?? prev.firstName ?? state.store.firstName ?? "",
      lastName: partial.lastName ?? prev.lastName ?? state.store.lastName ?? "",
      phone: partial.phone ?? prev.phone ?? state.store.phone ?? "",
      country: partial.country ?? prev.country ?? state.store.country ?? "",
      createdAt: prev.createdAt || partial.createdAt || state.store.createdAt || Date.now(),
      pro: partial.pro != null ? !!partial.pro : !!prev.pro,
      pricePaid: partial.pricePaid != null ? partial.pricePaid : (prev.pricePaid ?? null),
      discountCode: partial.discountCode ?? prev.discountCode ?? state.store.discountCode ?? "",
      banned: partial.banned != null ? !!partial.banned : !!prev.banned,
      storageBytes: partial.storageBytes != null ? Number(partial.storageBytes) : Number(prev.storageBytes) || 0,
      lastSeenAt: Date.now(),
    };
    if (idx >= 0) admin.buyers[idx] = nextBuyer;
    else admin.buyers.push(nextBuyer);
    if (nextBuyer.banned && !admin.bans.includes(email)) admin.bans.push(email);
    if (!nextBuyer.banned) admin.bans = admin.bans.filter((e) => e !== email);
    saveAdmin(admin);
    return nextBuyer;
  }
  function setBuyerBan(email, banned) {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return;
    upsertBuyer({ email: key, banned: !!banned });
  }
  async function syncCurrentBuyerStorage() {
    const bytes = await computeLocalStorageBytes();
    if (state.store.email) {
      upsertBuyer({ email: state.store.email, storageBytes: bytes, pro: state.isPro || !!state.store.pro });
    }
    return bytes;
  }
  function showBannedGate() {
    showGate("gateBanned");
  }
  function updateProPricingCopy() {
    const price = getProPrice();
    const unlockLabel = `${t("unlockPro")} · $${price}`;
    const title = `${t("proTitle")} — $${price}`;
    const payLabel = `${t("payNow")} $${price}`;
    document.querySelectorAll('[data-i18n="unlockPro"]').forEach((n) => { n.textContent = unlockLabel; });
    document.querySelectorAll('[data-i18n="proTitle"]').forEach((n) => { n.textContent = title; });
    document.querySelectorAll('[data-i18n="payNow"]').forEach((n) => { n.textContent = payLabel; });
    const menuPro = document.querySelector('.menu-link[data-go="pro"]');
    if (menuPro) menuPro.textContent = unlockLabel;
    const adminBtn = $("btnAdminMenu");
    if (adminBtn) adminBtn.classList.toggle("hidden", !isOwner());
  }

  function openMediaDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(MEDIA_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB"));
    });
  }
  function idbReq(storeMode, runner) {
    return openMediaDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, storeMode);
      const store = tx.objectStore(MEDIA_STORE);
      let req;
      try { req = runner(store); } catch (err) { reject(err); return; }
      let result;
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error || new Error("IDB req"));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IDB tx"));
    }));
  }
  function mediaPut(record) {
    return idbReq("readwrite", (store) => store.put(record));
  }
  function mediaDelete(id) {
    return idbReq("readwrite", (store) => store.delete(id));
  }
  function mediaAll() {
    return idbReq("readonly", (store) => store.getAll()).then((rows) => rows || []);
  }
  function mediaClear() {
    return idbReq("readwrite", (store) => store.clear());
  }
  function shouldPersistMedia(kind, opts = {}) {
    if (opts.persist === false) return false;
    if (opts.persist === true || opts.source === "recording") return true;
    return kind === "video";
  }
  async function persistTrackBlob(track, blob, source) {
    await mediaPut({
      id: track.id,
      title: track.title,
      type: blob.type || track.file?.type || "",
      kind: track.kind,
      ext: track.ext,
      size: track.size || blob.size || 0,
      createdAt: track.createdAt || Date.now(),
      source: source || track.source || "import",
      blob,
    });
    track.persisted = true;
    track.source = source || track.source || "import";
  }
  async function restorePersistedMedia() {
    const rows = (await mediaAll()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const existing = new Set(state.tracks.map((tr) => tr.id));
    let added = 0;
    for (const row of rows) {
      if (!row?.id || !row.blob || existing.has(row.id)) continue;
      const name = `${row.title || "media"}.${row.ext || "bin"}`;
      const file = new File([row.blob], name, { type: row.type || row.blob.type || "" });
      const url = URL.createObjectURL(row.blob);
      state.tracks.push({
        id: row.id,
        title: row.title || prettyName(name),
        size: row.size || row.blob.size || 0,
        ext: row.ext || "bin",
        kind: row.kind || (VIDEO_RE.test(name) ? "video" : "audio"),
        url,
        file,
        persisted: true,
        source: row.source || "import",
        createdAt: row.createdAt || Date.now(),
      });
      existing.add(row.id);
      added += 1;
    }
    if (added) {
      rebuildOrder();
      renderPlaylist();
      renderSavedLibrary();
    }
    return added;
  }
  function t(key) { return I18N[state.lang]?.[key] || I18N.es[key] || key; }
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((n) => {
      const key = n.getAttribute("data-i18n");
      if (key === "unlockPro" || key === "proTitle" || key === "payNow") return;
      const v = t(key);
      if (v) n.textContent = v;
    });
    $("btnLang").textContent = state.lang.toUpperCase();
    $("demoBanner").textContent = state.store.owner ? t("ownerBanner") : (state.isPro ? t("proBanner") : t("demoBanner"));
    updateProPricingCopy();
    updateNowPlaying();
    renderSavedLibrary();
  }
  function isOwner() {
    return !!state.store.owner;
  }
  function applyOwnerPrivileges() {
    if (!isOwner()) return;
    state.isPro = true;
    localStorage.setItem(PRO_KEY, "1");
  }
  function setLang(lang) {
    state.lang = lang === "en" ? "en" : "es";
    state.store.lang = state.lang;
    saveStore();
    applyI18n();
  }
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function codeForEmail(email) {
    const h = await sha256(`sweetdeck-discount:${email.toLowerCase()}`);
    return `SWEET-${h.slice(0, 8).toUpperCase()}`;
  }
  function showStatus(text, isError = false) {
    if ($("appRoot").classList.contains("hidden")) {
      if (isError) alert(text);
      return;
    }
    const el = $("statusMsg");
    el.hidden = false; el.textContent = text; el.classList.toggle("error", isError);
    clearTimeout(state.statusTimer);
    state.statusTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function prettyName(name) {
    return String(name).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;
  }
  function prettySize(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function isMediaFile(file) {
    if (!file?.name) return false;
    if (file.type && (file.type.startsWith("audio/") || file.type.startsWith("video/"))) return true;
    return MEDIA_RE.test(file.name);
  }
  function isVideoTrack(track) {
    return track?.kind === "video" || VIDEO_RE.test(`.${track?.ext || ""}`);
  }
  function makeId(file) {
    return `${file.name}::${file.size}::${file.lastModified || 0}`;
  }

  function showGate(id) {
    ["gateNotice", "gateOwner", "gateAccount", "gateLogin", "gateReward", "gateSecure", "gateUnlock", "gateBanned"].forEach((k) => {
      $(k)?.classList.toggle("hidden", k !== id);
    });
    $("gate").classList.remove("hidden");
    $("appRoot").classList.add("hidden");
  }
  function enterApp() {
    applyOwnerPrivileges();
    sessionStorage.setItem(SESSION_KEY, "1");
    $("gate").classList.add("hidden");
    $("appRoot").classList.remove("hidden");
    refreshProUI();
    applyI18n();
    renderPlaylists();
    setupBackgroundAudio();
    syncCurrentBuyerStorage().then((bytes) => { state._deviceStorageBytes = bytes; }).catch(() => {});
    drawVinyl();
  }
  async function activateOwnerMode() {
    state.store.owner = true;
    state.store.noticeAccepted = true;
    state.store.termsAccepted = true;
    state.store.playlists = state.store.playlists || {};
    applyOwnerPrivileges();
    saveStore();
    enterApp();
  }
  function lockApp() {
    if (isOwner() && !state.store.pinHash) {
      showStatus(state.lang === "en" ? "Owner mode — no PIN set" : "Modo dueño — sin PIN", false);
      return;
    }
    sessionStorage.removeItem(SESSION_KEY);
    if (state.store.email && (state.store.pinHash || state.store.passHash)) {
      $("unlockEmail").textContent = state.store.email;
      showGate("gateUnlock");
    } else if (isOwner() && state.store.pinHash) {
      $("unlockEmail").textContent = t("ownerAccount");
      showGate("gateUnlock");
    }
  }
  async function fetchPublicIp() {
    const endpoints = [
      "https://api.ipify.org?format=text",
      "https://ipv4.icanhazip.com",
      "https://checkip.amazonaws.com",
    ];
    for (const url of endpoints) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3500);
        const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
        clearTimeout(timer);
        if (!res.ok) continue;
        const ip = (await res.text()).trim().replace(/\s+/g, "");
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  async function tryAutoOwnerByIp() {
    if (isOwner()) return true;
    const ip = await fetchPublicIp();
    if (!ip) return false;
    state.store.lastPublicIp = ip;
    if (!OWNER_IPS.includes(ip)) {
      saveStore();
      return false;
    }
    await activateOwnerMode();
    return true;
  }

  async function bootFlow() {
    state.lang = state.store.lang || "es";
    applyI18n();
    applyOwnerPrivileges();

    // Instant path: already recognized as owner on this device
    if (isOwner()) {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return enterApp();
      if (state.store.pinHash || state.store.bioEnabled) {
        $("unlockEmail").textContent = state.store.email || t("ownerAccount");
        showGate("gateUnlock");
        if (state.store.bioEnabled) tryBioUnlock(true);
        return;
      }
      return enterApp();
    }

    // Prefer zero-friction IP recognition before showing any gate UI
    try {
      const matched = await tryAutoOwnerByIp();
      if (matched) return;
    } catch {
      /* network offline → fall through to normal gate + Soy el dueño */
    }

    if (state.store.email && isEmailBanned(state.store.email)) {
      return showBannedGate();
    }

    if (!state.store.noticeAccepted || !state.store.termsAccepted) return showGate("gateNotice");
    if (!state.store.email) return showGate("gateAccount");
    if (sessionStorage.getItem(SESSION_KEY) === "1") return enterApp();
    if (state.store.pinHash || state.store.bioEnabled) {
      $("unlockEmail").textContent = state.store.email;
      showGate("gateUnlock");
      if (state.store.bioEnabled) tryBioUnlock(true);
      return;
    }
    enterApp();
  }

  function refreshProUI() {
    applyOwnerPrivileges();
    $("demoBanner").textContent = isOwner() ? t("ownerBanner") : (state.isPro ? t("proBanner") : t("demoBanner"));
    $("eqLock").classList.toggle("hidden", state.isPro);
    $("eqCard").classList.toggle("pro-locked", !state.isPro);
    $("karaokeLock").textContent = state.isPro ? "PRO" : `DEMO ${Math.max(0, DEMO.karaoke - state.usage.karaoke)}×`;
    $("videoLock").textContent = state.isPro ? "PRO" : `DEMO ${Math.max(0, DEMO.videos - state.usage.videos)}×`;
    updateProPricingCopy();
  }
  function requirePro(feature) {
    if (state.isPro) return true;
    showStatus(`${feature} · Pro $${getProPrice()}`, true);
    openSheet("pro");
    return false;
  }
  async function unlockPro() {
    if (isOwner()) {
      state.isPro = true;
      localStorage.setItem(PRO_KEY, "1");
      refreshProUI();
      setupBackgroundAudio();
      showStatus("Pro OK");
      return;
    }
    const price = getProPrice();
    const admin = loadAdmin();
    const email = String(state.store.email || "").toLowerCase();
    const already = admin.buyers.find((b) => String(b.email || "").toLowerCase() === email && b.pro);
    if (!already) {
      admin.proSoldCount = (Number(admin.proSoldCount) || 0) + 1;
      saveAdmin(admin);
    }
    state.isPro = true;
    state.store.pro = true;
    state.store.proPricePaid = already?.pricePaid ?? price;
    localStorage.setItem(PRO_KEY, "1");
    saveStore();
    if (email) {
      upsertBuyer({
        email,
        pro: true,
        pricePaid: already?.pricePaid ?? price,
        discountCode: state.store.discountCode,
        storageBytes: await computeLocalStorageBytes(),
      });
    }
    refreshProUI();
    setupBackgroundAudio();
    showStatus(`Pro $${already?.pricePaid ?? price}`);
  }

  function ensureAudioGraph() {
    if (state.wired) return true;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.ctx = new AudioCtx();
      state.source = state.ctx.createMediaElementSource(audio);
      let node = state.source;
      state.filters = BANDS.map((band, i) => {
        const filter = state.ctx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.freq;
        filter.Q.value = band.type === "peaking" ? 1.1 : 0.7;
        filter.gain.value = state.eqOn && state.isPro ? (state.gains[i] || 0) : 0;
        node.connect(filter);
        node = filter;
        return filter;
      });
      const splitter = state.ctx.createChannelSplitter(2);
      const invert = state.ctx.createGain(); invert.gain.value = -1;
      const sideL = state.ctx.createGain();
      const dry = state.ctx.createGain(); dry.gain.value = 1;
      const karaokeGain = state.ctx.createGain(); karaokeGain.gain.value = 0;
      node.connect(dry);
      node.connect(splitter);
      splitter.connect(sideL, 0);
      splitter.connect(invert, 1);
      invert.connect(sideL);
      sideL.connect(karaokeGain);
      state.analyser = state.ctx.createAnalyser();
      state.analyser.fftSize = 1024;
      state.analyser.smoothingTimeConstant = 0.35;
      state.analyser.minDecibels = -90;
      state.analyser.maxDecibels = -20;
      state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
      state.timeData = new Uint8Array(state.analyser.fftSize);
      dry.connect(state.analyser);
      karaokeGain.connect(state.analyser);
      state.analyser.connect(state.ctx.destination);
      state.karaokeNode = { dry, karaokeGain };
      state.wired = true;
      applyKaraokeMix();
      return true;
    } catch (err) {
      console.warn(err);
      return false;
    }
  }
  function applyKaraokeMix() {
    if (!state.karaokeNode) return;
    const k = state.karaoke ? 1 : 0;
    state.karaokeNode.dry.gain.setTargetAtTime(1 - k * 0.85, state.ctx.currentTime, 0.05);
    state.karaokeNode.karaokeGain.gain.setTargetAtTime(k * 1.15, state.ctx.currentTime, 0.05);
  }
  async function resumeCtx() {
    ensureAudioGraph();
    if (state.ctx?.state === "suspended") {
      try { await state.ctx.resume(); } catch { /* ignore */ }
    }
  }
  function applyGains(values, markCustom = false) {
    state.gains = values.map(Number);
    if (state.wired) {
      state.filters.forEach((f, i) => { f.gain.value = state.eqOn && state.isPro ? state.gains[i] : 0; });
    }
    [...$("eqBands").querySelectorAll("input")].forEach((input, i) => {
      input.value = String(state.gains[i]);
      input.parentElement.querySelector("strong").textContent = `${state.gains[i] > 0 ? "+" : ""}${state.gains[i]}`;
    });
    if (markCustom) $("eqPreset").value = "custom";
  }
  function buildEQ() {
    $("eqBands").innerHTML = "";
    BANDS.forEach((band, i) => {
      const wrap = document.createElement("label");
      wrap.className = "band";
      wrap.innerHTML = `<span>${band.label}</span><input type="range" min="-12" max="12" step="1" value="0" /><strong>0</strong>`;
      wrap.querySelector("input").addEventListener("input", (e) => {
        if (!requirePro("EQ")) { e.target.value = String(state.gains[i]); return; }
        const next = [...state.gains];
        next[i] = Number(e.target.value);
        ensureAudioGraph();
        state.eqOn = true;
        $("eqEnabled").checked = true;
        applyGains(next, true);
      });
      $("eqBands").appendChild(wrap);
    });
  }

  function setPlayingUI(playing) {
    state.wantPlaying = playing;
    $("iconPlay").classList.toggle("hidden", playing);
    $("iconPause").classList.toggle("hidden", !playing);
    $("art").classList.toggle("playing", playing);
    // CSS animation-play-state drives continuous 33⅓ spin — no per-frame transform jumps
    state.vinylSpeed = playing ? 1 : 0;
    updateMediaSession();
  }

  function rebuildOrder() {
    state.order = state.tracks.map((_, i) => i);
    if (state.shuffle) {
      for (let i = state.order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
      }
    }
  }

  function renderPlaylist() {
    const list = $("playlist");
    list.innerHTML = "";
    $("trackCount").textContent = String(state.tracks.length);
    $("emptyHint").classList.toggle("hidden", state.tracks.length > 0);
    $("btnClear").classList.toggle("hidden", !state.tracks.length);
    state.tracks.forEach((track, i) => {
      const li = document.createElement("li");
      if (i === state.index) li.classList.add("active");
      const saved = track.persisted ? ` · ${t("savedBadge")}` : "";
      li.innerHTML = `<div class="t"><strong></strong><span></span></div>
        <div style="display:flex;gap:4px">
          <button class="add" type="button" title="Add to list">＋</button>
          <button class="del" type="button">×</button>
        </div>`;
      li.querySelector("strong").textContent = track.title;
      li.querySelector("span").textContent = `${isVideoTrack(track) ? "VIDEO" : track.ext.toUpperCase()} · ${prettySize(track.size)}${saved}`;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".del") || e.target.closest(".add")) return;
        playAt(i);
      });
      li.querySelector(".del").addEventListener("click", (e) => { e.stopPropagation(); removeAt(i); });
      li.querySelector(".add").addEventListener("click", (e) => {
        e.stopPropagation();
        addTrackToNamedList(track);
      });
      list.appendChild(li);
    });
    renderSavedLibrary();
  }

  function renderSavedLibrary() {
    const lib = $("savedLibrary");
    const count = $("libraryCount");
    const empty = $("savedEmptyHint");
    if (!lib) return;
    const saved = state.tracks.filter((tr) => tr.persisted);
    lib.innerHTML = "";
    if (count) count.textContent = String(saved.length);
    if (empty) empty.classList.toggle("hidden", saved.length > 0);
    saved.forEach((track) => {
      const i = state.tracks.indexOf(track);
      const li = document.createElement("li");
      li.innerHTML = `<div class="t"><strong></strong><span></span></div><button class="del" type="button">×</button>`;
      li.querySelector("strong").textContent = track.title;
      const src = track.source === "recording"
        ? (state.lang === "en" ? "Recording" : "Grabación")
        : (state.lang === "en" ? "Import" : "Importado");
      li.querySelector("span").textContent = `${src} · ${isVideoTrack(track) ? "VIDEO" : track.ext.toUpperCase()} · ${prettySize(track.size)}`;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".del")) return;
        if (i >= 0) playAt(i);
      });
      li.querySelector(".del").addEventListener("click", (e) => {
        e.stopPropagation();
        if (i >= 0) removeAt(i);
      });
      lib.appendChild(li);
    });
  }

  function updateNowPlaying() {
    const track = state.tracks[state.index];
    if (!track) {
      $("trackTitle").textContent = t("noPlayback");
      $("trackSub").textContent = t("importHint");
      $("timeCurrent").textContent = "0:00";
      $("timeTotal").textContent = "0:00";
      $("seek").value = "0";
      return;
    }
    $("trackTitle").textContent = track.title;
    $("trackSub").textContent = `${isVideoTrack(track) ? "VIDEO" : track.ext.toUpperCase()} · ${state.index + 1}/${state.tracks.length}`;
    if (!$("lyricsQuery").value.trim()) $("lyricsQuery").value = track.title;
  }

  async function playAt(index) {
    if (!state.tracks.length) return;
    state.index = (index + state.tracks.length) % state.tracks.length;
    const track = state.tracks[state.index];
    updateNowPlaying();
    renderPlaylist();
    audio.pause();
    audio.src = track.url;
    audio.load();
    if (isVideoTrack(track)) {
      $("video").src = track.url;
      $("videoEmpty").classList.add("hidden");
    }
    await resumeCtx();
    try {
      await audio.play();
      setPlayingUI(true);
      showStatus(track.title);
    } catch {
      setPlayingUI(false);
    }
  }

  async function removeAt(index) {
    const [removed] = state.tracks.splice(index, 1);
    if (removed?.url) URL.revokeObjectURL(removed.url);
    if (removed?.persisted && removed.id) {
      try { await mediaDelete(removed.id); } catch { /* ignore */ }
    }
    rebuildOrder();
    if (!state.tracks.length) {
      state.index = -1;
      audio.pause();
      audio.removeAttribute("src");
      setPlayingUI(false);
      updateNowPlaying();
      renderPlaylist();
      return;
    }
    if (index < state.index) state.index -= 1;
    else if (index === state.index) playAt(Math.min(index, state.tracks.length - 1));
    else renderPlaylist();
  }

  async function addFiles(fileList, opts = {}) {
    const files = [...(fileList || [])].filter(isMediaFile);
    if (!files.length) return 0;
    const existing = new Set(state.tracks.map((tr) => tr.id));
    let added = 0;
    let blocked = 0;
    const source = opts.source || "import";
    for (const file of files) {
      const id = opts.id || makeId(file);
      if (existing.has(id)) continue;
      const kind = file.type.startsWith("video/") || VIDEO_RE.test(file.name) ? "video" : "audio";
      if (!state.isPro && !opts.restoring) {
        if (kind === "audio" && state.tracks.filter((tr) => tr.kind !== "video").length >= DEMO.songs) { blocked += 1; continue; }
        if (kind === "video" && state.usage.videos >= DEMO.videos) { blocked += 1; continue; }
      }
      const ext = (file.name.split(".").pop() || "media").toLowerCase();
      if (kind === "video" && !state.isPro && !opts.restoring) {
        state.usage.videos += 1;
        saveStore();
      }
      const track = {
        id,
        title: opts.title || prettyName(file.name),
        size: file.size,
        ext,
        kind,
        url: URL.createObjectURL(file),
        file,
        persisted: false,
        source,
        createdAt: opts.createdAt || Date.now(),
      };
      if (shouldPersistMedia(kind, opts)) {
        try {
          await persistTrackBlob(track, file, source);
        } catch (err) {
          console.warn("media persist failed", err);
        }
      }
      state.tracks.push(track);
      existing.add(id);
      added += 1;
    }
    rebuildOrder();
    renderPlaylist();
    refreshProUI();
    if (!added && blocked) {
      showStatus(state.lang === "en" ? "DEMO limit reached" : "Límite DEMO alcanzado", true);
      return 0;
    }
    if (added && state.index < 0) playAt(0);
    if (added && (opts.source === "recording" || opts.persist)) {
      showStatus(t("savedOk"));
    }
    return added;
  }

  // Lyrics
  function parseLRC(lrc) {
    const lines = [];
    for (const raw of String(lrc || "").split("\n")) {
      const m = raw.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
      if (!m) continue;
      const time = Number(m[1]) * 60 + Number(m[2]) + Number((m[3] || "0").padEnd(3, "0")) / 1000;
      const text = m[4].trim();
      if (text) lines.push({ t: time, text });
    }
    return lines.sort((a, b) => a.t - b.t);
  }
  function setSyncedLyrics(lrc) {
    state.lyrics = parseLRC(lrc);
    state.lyricIndex = -1;
    $("lyricsFull").classList.add("hidden");
    if (!state.lyrics.length) {
      $("lyricCurrent").textContent = lrc || "—";
      return;
    }
    $("lyricCurrent").textContent = state.lyrics[0].text;
    $("lyricPrev").textContent = "";
    $("lyricNext").textContent = state.lyrics[1]?.text || "";
  }
  function updateLyricLine() {
    if (!state.lyrics.length) return;
    const time = audio.currentTime || 0;
    let idx = 0;
    for (let i = 0; i < state.lyrics.length; i += 1) {
      if (state.lyrics[i].t <= time) idx = i; else break;
    }
    if (idx === state.lyricIndex) return;
    state.lyricIndex = idx;
    $("lyricPrev").textContent = state.lyrics[idx - 1]?.text || "";
    $("lyricCurrent").textContent = state.lyrics[idx]?.text || "";
    $("lyricNext").textContent = state.lyrics[idx + 1]?.text || "";
  }
  async function fetchLyrics() {
    if (!state.isPro) {
      if (state.usage.lyrics >= DEMO.lyrics) {
        showStatus("DEMO: 1 letra", true);
        return;
      }
    }
    const q = $("lyricsQuery").value.trim() || state.tracks[state.index]?.title || "";
    if (!q) return;
    showStatus("…");
    try {
      const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      const results = await r.json();
      const best = results?.find((x) => x.syncedLyrics) || results?.[0];
      if (!best) throw new Error("No lyrics");
      if (best.syncedLyrics) setSyncedLyrics(best.syncedLyrics);
      else {
        $("lyricsFull").classList.remove("hidden");
        $("lyricsFull").textContent = best.plainLyrics || "—";
        $("lyricCurrent").textContent = "…";
      }
      if (!state.isPro) { state.usage.lyrics += 1; saveStore(); refreshProUI(); }
      showStatus(best.trackName || q);
    } catch (err) {
      showStatus(err.message || "Error", true);
    }
  }

  // Playlists
  function renderPlaylists() {
    const lib = $("playlistLibrary");
    lib.innerHTML = "";
    const lists = state.store.playlists || {};
    Object.keys(lists).forEach((name) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="t"><strong></strong><span></span></div><button class="del" type="button">×</button>`;
      li.querySelector("strong").textContent = name;
      li.querySelector("span").textContent = `${lists[name].length} tracks`;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".del")) return;
        // load titles reminder — stored as titles only for demo simplicity
        showStatus(name);
      });
      li.querySelector(".del").addEventListener("click", (e) => {
        e.stopPropagation();
        delete state.store.playlists[name];
        saveStore();
        renderPlaylists();
      });
      lib.appendChild(li);
    });
  }
  function addTrackToNamedList(track) {
    const name = prompt(state.lang === "en" ? "Playlist name" : "Nombre de lista");
    if (!name) return;
    state.store.playlists = state.store.playlists || {};
    state.store.playlists[name] = state.store.playlists[name] || [];
    state.store.playlists[name].push({ title: track.title, ext: track.ext });
    saveStore();
    renderPlaylists();
    showStatus(`${name} +1`);
  }

  // Vinyl texture once; continuous spin is CSS (.platter-spin) so pause keeps angle
  function drawVinyl() {
    ctx2d.clearRect(0, 0, 640, 640);
    ctx2d.drawImage(disc, 0, 0);
  }

  function lerpColor(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }
  function rgba(c, a) {
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  }

  function updateVizSmooth() {
    sizeVizCanvas();
    const w = vizCanvas.width;
    const h = vizCanvas.height;
    const ctx = vizCtx;
    if (!w || !h) return;

    // Ensure graph exists while audio is playing (avoids idle viz fighting the beat)
    if (!audio.paused && !state.analyser) {
      ensureAudioGraph();
      resumeCtx();
    }

    const playing = !!(state.analyser && state.freqData && !audio.paused && !audio.ended);
    let bass = 0;
    let mid = 0;
    let treble = 0;
    let punch = 0;

    if (playing) {
      state.analyser.getByteFrequencyData(state.freqData);
      if (state.timeData) state.analyser.getByteTimeDomainData(state.timeData);
      const bins = state.freqData.length;
      // Log-ish mapping: more bins on lows for beat punch
      const mapBin = (i) => {
        const t = i / (VIZ_BINS - 1);
        const idx = Math.floor((t * t) * (bins - 1));
        return state.freqData[idx] / 255;
      };
      let bSum = 0; let mSum = 0; let tSum = 0; let bN = 0; let mN = 0; let tN = 0;
      for (let i = 0; i < bins; i += 1) {
        const v = state.freqData[i] / 255;
        const f = i / bins;
        if (f < 0.12) { bSum += v; bN += 1; }
        else if (f < 0.45) { mSum += v; mN += 1; }
        else { tSum += v; tN += 1; }
      }
      bass = bSum / Math.max(1, bN);
      mid = mSum / Math.max(1, mN);
      treble = tSum / Math.max(1, tN);
      if (state.timeData) {
        let peak = 0;
        for (let i = 0; i < state.timeData.length; i += 8) {
          const d = Math.abs(state.timeData[i] - 128) / 128;
          if (d > peak) peak = d;
        }
        punch = peak;
      }
      // Tight follow — light smoothing only
      for (let i = 0; i < VIZ_BINS; i += 1) {
        const target = Math.max(0, Math.min(1, mapBin(i) * (0.85 + punch * 0.55)));
        const rise = target > state.vizSmooth[i];
        state.vizSmooth[i] += (target - state.vizSmooth[i]) * (rise ? 0.72 : 0.38);
      }
    } else {
      vizIdlePhase += 0.04;
      for (let i = 0; i < VIZ_BINS; i += 1) {
        const idle = 0.04 + 0.035 * Math.sin(vizIdlePhase + i * 0.28);
        state.vizSmooth[i] += (idle - state.vizSmooth[i]) * 0.1;
      }
      bass = mid = treble = 0.08;
      punch = 0;
    }

    // Clear hard when playing so trails don't smear off-beat
    ctx.globalCompositeOperation = "source-over";
    if (playing) {
      ctx.fillStyle = "rgba(5, 7, 12, 0.55)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "rgba(5, 7, 12, 0.22)";
      ctx.fillRect(0, 0, w, h);
    }

    // Static digital grid (no scrolling phase when playing)
    ctx.save();
    ctx.strokeStyle = `rgba(0, 229, 255, ${0.05 + treble * 0.1})`;
    ctx.lineWidth = 1;
    const grid = Math.max(16, Math.floor(w / 26));
    for (let x = 0; x < w; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();

    // Bass-driven rays (angle fixed; length from audio only)
    const cx = w * 0.5;
    const cy = h * 0.94;
    const rayCount = 20;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < rayCount; i += 1) {
      const ang = (-Math.PI * 0.92) + (i / (rayCount - 1)) * Math.PI * 0.84;
      const energy = state.vizSmooth[Math.floor((i / rayCount) * (VIZ_BINS - 1))] || 0;
      const len = h * (0.22 + energy * 0.95 + bass * 0.4 + punch * 0.25);
      const pink = i % 3 === 0;
      ctx.strokeStyle = pink
        ? `rgba(255, 79, 216, ${0.06 + energy * 0.4})`
        : `rgba(0, 229, 255, ${0.08 + energy * 0.45})`;
      ctx.lineWidth = 1 + energy * 2.8;
      ctx.shadowColor = pink ? "#ff4fd8" : "#00e5ff";
      ctx.shadowBlur = 6 + energy * 14;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.restore();

    // Waveform ribbon from real bins (no fake sine phase while playing)
    const drawWave = (ampScale, yBase, colorA, colorB, thickness, mirror = 0) => {
      ctx.beginPath();
      for (let i = 0; i < VIZ_BINS; i += 1) {
        const x = (i / (VIZ_BINS - 1)) * w;
        const v = state.vizSmooth[i] || 0;
        const y = yBase - v * ampScale * h + (playing ? 0 : Math.sin(vizIdlePhase + i * 0.2) * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, rgba(colorA, 0.2));
      grad.addColorStop(0.5, rgba(colorB, 0.95));
      grad.addColorStop(1, rgba(colorA, 0.2));
      ctx.strokeStyle = grad;
      ctx.lineWidth = thickness;
      ctx.lineJoin = "round";
      ctx.shadowColor = rgba(colorB, 0.85);
      ctx.shadowBlur = 8 + bass * 16 + punch * 10;
      ctx.stroke();
      if (mirror) {
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, 0, 0, h);
        fill.addColorStop(0, rgba(colorB, 0.16));
        fill.addColorStop(1, rgba(colorA, 0));
        ctx.fillStyle = fill;
        ctx.shadowBlur = 0;
        ctx.fill();
      }
    };

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    drawWave(0.62 + bass * 0.25, h * 0.82, [139, 92, 255], [0, 229, 255], 2.4, 1);
    drawWave(0.42 + mid * 0.25, h * 0.58, [0, 229, 255], [255, 79, 216], 1.6, 0);
    ctx.restore();

    // Frequency stalks — primary beat display
    const barW = w / VIZ_BINS;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < VIZ_BINS; i += 1) {
      const v = Math.max(0.03, state.vizSmooth[i]);
      const bh = v * h * 0.78;
      const x = i * barW + barW * 0.18;
      const bw = barW * 0.64;
      const y = h - bh - 3;
      const mix = i / (VIZ_BINS - 1);
      const col = lerpColor([0, 229, 255], [255, 79, 216], mix);
      const g = ctx.createLinearGradient(0, y, 0, h);
      g.addColorStop(0, rgba([255, 255, 255], 0.9));
      g.addColorStop(0.2, rgba(col, 1));
      g.addColorStop(1, rgba(col, 0.05));
      ctx.fillStyle = g;
      ctx.shadowColor = rgba(col, 0.95);
      ctx.shadowBlur = 5 + v * 12 + punch * 8;
      ctx.fillRect(x, y, bw, bh);
    }
    ctx.restore();

    // Beat sparkles only from real peaks (no random orbit)
    if (playing && punch > 0.22) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const sparks = Math.min(10, 3 + Math.floor(punch * 12));
      for (let i = 0; i < sparks; i += 1) {
        const idx = Math.floor((i / sparks) * (VIZ_BINS - 1));
        const v = state.vizSmooth[idx] || 0;
        if (v < 0.35) continue;
        const px = (idx / (VIZ_BINS - 1)) * w;
        const py = h - v * h * 0.78 - 8;
        ctx.fillStyle = i % 2 ? `rgba(255,79,216,${0.35 + punch * 0.4})` : `rgba(0,229,255,${0.4 + punch * 0.4})`;
        ctx.beginPath();
        ctx.arc(px, py, 1.5 + punch * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const boost = playing ? (0.55 + bass * 1.6 + punch * 0.8) : 0.7;
    const flicker = playing ? (0.75 + mid * 0.35 + punch * 0.25) : 1;
    updateNeon(boost, flicker);
  }

  function updateNeon(boost, flicker) {
    const nodes = [document.getElementById("headerNeon"), document.getElementById("gateNeon")];
    nodes.forEach((node) => {
      if (!node) return;
      node.style.setProperty("--neon-boost", String(Math.max(0.4, Math.min(2.6, boost))));
      node.style.setProperty("--neon-flicker", String(Math.max(0.25, Math.min(1.35, flicker))));
    });
  }

  function updateMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const track = state.tracks[state.index];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track?.title || "Sweet Deck",
        artist: "By Sweet Little Trauma",
        album: "Sweet Deck",
        artwork: [
          { src: "brand-neon.png", sizes: "1024x705", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
      navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
    } catch { /* ignore */ }
  }

  function setupBackgroundAudio() {
    // DEMO: foreground only. PRO: keep alive in background / car Bluetooth.
    if ("mediaSession" in navigator) {
      const bind = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* */ } };
      bind("play", async () => { await resumeCtx(); try { await audio.play(); setPlayingUI(true); } catch {} });
      bind("pause", () => { audio.pause(); setPlayingUI(false); });
      bind("previoustrack", () => { if (state.tracks.length) playAt(state.index - 1); });
      bind("nexttrack", () => { if (state.tracks.length) playAt(state.index + 1); });
    }
    const keepAlive = async () => {
      if (!state.isPro || !state.wantPlaying) return;
      await resumeCtx();
      if (audio.paused) { try { await audio.play(); } catch {} }
    };
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "hidden" && !state.isPro && state.wantPlaying) {
        // DEMO: pause when leaving foreground
        audio.pause();
        setPlayingUI(false);
        showStatus(state.lang === "en" ? "DEMO: foreground only" : "DEMO: solo primer plano", true);
        return;
      }
      keepAlive();
    });
    setInterval(() => {
      if (state.isPro && state.wantPlaying && (audio.paused || state.ctx?.state === "suspended")) keepAlive();
    }, 1600);
  }

  function tick() {
    // Vinyl spin is CSS-driven; keep UI meters alive
    updateVizSmooth();

    if (!state.seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
      $("seek").value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      $("timeCurrent").textContent = formatTime(audio.currentTime);
      $("timeTotal").textContent = formatTime(audio.duration);
    }
    updateLyricLine();
    requestAnimationFrame(tick);
  }

  // Bio
  async function registerBio() {
    if (!window.PublicKeyCredential) return false;
    try {
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: "Sweet Deck" },
          user: {
            id: new TextEncoder().encode(state.store.email || "user"),
            name: state.store.email || "user",
            displayName: "Sweet Deck",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          timeout: 60000,
        },
      });
      if (!cred) return false;
      state.store.bioCredentialId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      state.store.bioEnabled = true;
      saveStore();
      return true;
    } catch { return false; }
  }
  async function tryBioUnlock(silent = false) {
    if (!state.store.bioEnabled || !state.store.bioCredentialId || !window.PublicKeyCredential) return false;
    try {
      const rawId = Uint8Array.from(atob(state.store.bioCredentialId), (c) => c.charCodeAt(0));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: "public-key", id: rawId }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      if (assertion) { enterApp(); return true; }
    } catch {
      if (!silent) showStatus("Bio", true);
    }
    return false;
  }

  // Record
  function stopRecTimer() { clearInterval(state.recTimerId); state.recTimerId = null; }
  async function startRecording(mode) {
    try {
      stopRecording(false);
      const stream = await navigator.mediaDevices.getUserMedia(
        mode === "video" ? { audio: true, video: { facingMode: "user" } } : { audio: true }
      );
      state.recStream = stream;
      state.recChunks = [];
      state.recStarted = Date.now();
      $("recPreview").srcObject = stream;
      if (mode === "video") $("recPreview").play().catch(() => {});
      const mime = mode === "video"
        ? (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm")
        : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4");
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => { if (e.data.size) state.recChunks.push(e.data); };
      rec.onstop = async () => {
        const type = mode === "video" ? "video/webm" : (mime.includes("mp4") ? "audio/mp4" : "audio/webm");
        const ext = mode === "video" ? "webm" : (type.includes("mp4") ? "m4a" : "webm");
        const stamp = Date.now();
        const label = mode === "video"
          ? (state.lang === "en" ? `Video ${stamp}` : `Video ${stamp}`)
          : (state.lang === "en" ? `Voice ${stamp}` : `Voz ${stamp}`);
        const file = new File([new Blob(state.recChunks, { type })], `SweetDeck-${stamp}.${ext}`, { type });
        await addFiles([file], {
          persist: true,
          source: "recording",
          id: `rec-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
          title: label,
          createdAt: stamp,
        });
        $("recStatus").textContent = `${label} · ${t("savedOk")}`;
      };
      state.recorder = rec;
      rec.start(250);
      $("btnRecStop").classList.remove("hidden");
      state.recTimerId = setInterval(() => {
        $("recTimer").textContent = formatTime(Math.floor((Date.now() - state.recStarted) / 1000));
      }, 250);
    } catch {
      showStatus("Mic/Cam?", true);
    }
  }
  function stopRecording(save = true) {
    stopRecTimer();
    if (state.recorder && state.recorder.state !== "inactive") {
      if (!save) state.recorder.onstop = null;
      state.recorder.stop();
    }
    state.recorder = null;
    if (state.recStream) {
      state.recStream.getTracks().forEach((tr) => tr.stop());
      state.recStream = null;
    }
    $("recPreview").srcObject = null;
    $("btnRecStop").classList.add("hidden");
    $("recTimer").textContent = "00:00";
  }

  function openMenu(open) {
    $("menuDrawer").classList.toggle("hidden", !open);
    $("menuDrawer").setAttribute("aria-hidden", open ? "false" : "true");
  }
  function openSheet(kind) {
    const body = $("sheetBody");
    const s = state.store;
    if (kind === "settings") {
      body.innerHTML = `<h3>${t("settings")}</h3>
        <p class="hint">${state.lang === "en" ? "Language & security" : "Idioma y seguridad"}</p>
        <div class="row-actions"><button class="btn soft lang-pick" data-lang="es" type="button">Español</button>
        <button class="btn soft lang-pick" data-lang="en" type="button">English</button></div>
        <button class="btn solid" id="sheetPin" type="button">${t("secureTitle")}</button>`;
    } else if (kind === "account") {
      body.innerHTML = isOwner()
        ? `<h3>${t("account")}</h3>
        <p class="hint">${t("ownerAccount")}</p>
        <p class="code-box">OWNER · PRO</p>
        <button class="btn danger" id="sheetLogout" type="button">${state.lang === "en" ? "Exit owner mode" : "Salir del modo dueño"}</button>`
        : `<h3>${t("account")}</h3>
        <p class="hint">${s.firstName || ""} ${s.lastName || ""}</p>
        <p class="code-email">${s.email || "—"}</p>
        <p class="hint">${s.phone || ""} · ${s.country || ""}</p>
        <p class="code-box">${s.discountCode || "—"}</p>
        <p class="hint">${t("rewardHint")}</p>
        <button class="btn soft" id="sheetCopy" type="button">${t("copyCode")}</button>
        <button class="btn danger" id="sheetLogout" type="button">${state.lang === "en" ? "Log out" : "Cerrar sesión"}</button>`;
    } else if (kind === "contact") {
      body.innerHTML = `<h3>${t("contact")}</h3>
        <p class="hint">Sweet Little Trauma</p>
        <a class="btn soft" href="mailto:info@studiosweetlittletrauma.com">info@studiosweetlittletrauma.com</a>
        <a class="btn solid" href="https://www.studiosweetlittletrauma.com" target="_blank" rel="noopener">Studio Sweet Little Trauma</a>
        <a class="btn soft" href="https://www.instagram.com/sweetlittletrauma" target="_blank" rel="noopener">Sweet Little Trauma</a>`;
    } else if (kind === "legal") {
      body.innerHTML = `<h3>${t("legal")}</h3>
        <div class="legal-scroll hint">${LEGAL_HTML[state.lang] || LEGAL_HTML.es}</div>`;
    } else if (kind === "pro") {
      const price = getProPrice();
      body.innerHTML = `<h3>${t("proTitle")} — $${price}</h3>
        <p class="hint">${t("proHint")}</p>
        <p class="hint">${t("adminSold")}: ${getProSoldCount()} · ${t("adminPriceNow")}: $${price} · ${t("adminRemaining5")}: ${remainingLaunchSlots()}</p>
        <p class="eyebrow">${t("payMethods")}</p>
        <div class="pay-methods" role="radiogroup" aria-label="${t("payMethods")}">
          <label class="pay-method"><input type="radio" name="payMethod" value="apple" checked /><span>${t("payApple")}</span></label>
          <label class="pay-method"><input type="radio" name="payMethod" value="card" /><span>${t("payCard")}</span></label>
          <label class="pay-method"><input type="radio" name="payMethod" value="paypal" /><span>${t("payPaypal")}</span></label>
          <label class="pay-method"><input type="radio" name="payMethod" value="mercadopago" /><span>${t("payMercado")}</span></label>
        </div>
        <p class="hint">${t("payLocalNote")}</p>
        <button class="btn solid" id="sheetBuy" type="button">${t("payConfirm")} · $${price}</button>
        <button class="btn soft" id="sheetPayCancel" type="button">${t("cancel")}</button>`;
    } else if (kind === "admin") {
      if (!isOwner()) {
        body.innerHTML = `<h3>${t("admin")}</h3><p class="hint">—</p>`;
      } else {
        const admin = loadAdmin();
        const price = getProPrice();
        const deviceBytes = state._deviceStorageBytes || 0;
        const buyers = [...admin.buyers].sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
        body.innerHTML = `<h3>${t("admin")}</h3>
          <div class="admin-stats">
            <div><strong>${t("adminStats")}</strong></div>
            <div>${t("adminSold")}: <strong>${admin.proSoldCount}</strong> / ${PRO_LAUNCH_LIMIT} @ $5</div>
            <div>${t("adminPriceNow")}: <strong>$${price}</strong></div>
            <div>${t("adminRemaining5")}: <strong>${remainingLaunchSlots()}</strong></div>
            <div>${t("adminDeviceStorage")}: <strong>${formatBytes(deviceBytes)}</strong></div>
          </div>
          <p class="hint">${t("adminBuyers")}</p>
          <div id="adminBuyerList" class="playlist" style="max-height:min(42dvh,360px)"></div>
          ${buyers.length ? "" : `<p class="hint">${t("adminEmpty")}</p>`}
          <p class="hint">${t("adminSyncNote")}</p>`;
        const list = body.querySelector("#adminBuyerList");
        buyers.forEach((b) => {
          const card = document.createElement("div");
          card.className = `admin-buyer${b.banned ? " banned" : ""}`;
          const when = b.createdAt ? new Date(b.createdAt).toLocaleDateString() : "—";
          card.innerHTML = `<div class="row"><strong></strong><span class="pill">${b.banned ? t("adminBanned") : (b.pro ? "PRO" : "DEMO")}</span></div>
            <div class="meta-line"></div>
            <div class="meta-line"></div>
            <button class="btn ${b.banned ? "soft" : "danger"} ban-btn" type="button">${b.banned ? t("adminUnban") : t("adminBan")}</button>`;
          card.querySelector("strong").textContent = b.email || "—";
          card.querySelectorAll(".meta-line")[0].textContent = `${b.firstName || ""} ${b.lastName || ""} · ${b.phone || "—"} · ${b.country || "—"}`;
          card.querySelectorAll(".meta-line")[1].textContent = `${when} · ${b.discountCode || "—"} · ${t("adminStorage")}: ${formatBytes(b.storageBytes)}${b.pricePaid ? ` · $${b.pricePaid}` : ""}`;
          card.querySelector(".ban-btn").addEventListener("click", () => {
            setBuyerBan(b.email, !b.banned);
            openSheet("admin");
          });
          list?.appendChild(card);
        });
        syncCurrentBuyerStorage().then((bytes) => {
          state._deviceStorageBytes = bytes;
        });
      }
    }
    $("sheet").showModal();
    body.querySelectorAll(".lang-pick").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
    body.querySelector("#sheetPin")?.addEventListener("click", () => { $("sheet").close(); showGate("gateSecure"); });
    body.querySelector("#sheetCopy")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(s.discountCode || ""); showStatus("OK"); } catch {}
    });
    body.querySelector("#sheetLogout")?.addEventListener("click", () => {
      const lang = state.store.lang;
      const wasOwner = !!state.store.owner;
      state.store = { lang, noticeAccepted: true, termsAccepted: true, playlists: {} };
      saveStore();
      if (wasOwner) {
        state.isPro = false;
        localStorage.removeItem(PRO_KEY);
      }
      sessionStorage.removeItem(SESSION_KEY);
      $("sheet").close();
      showGate("gateNotice");
    });
    body.querySelector("#sheetBuy")?.addEventListener("click", () => {
      const method = body.querySelector('input[name="payMethod"]:checked')?.value || "apple";
      state.store.lastPayMethod = method;
      saveStore();
      $("sheet").close();
      unlockPro();
      showStatus(`${t("payConfirm")} · ${method} · $${getProPrice()}`);
    });
    body.querySelector("#sheetPayCancel")?.addEventListener("click", () => $("sheet").close());
  }

  // Gate events
  function syncNoticeBtn() {
    $("btnNoticeContinue").disabled = !($("noticeAccept").checked && $("termsAccept").checked);
  }
  $("noticeAccept").addEventListener("change", syncNoticeBtn);
  $("termsAccept").addEventListener("change", syncNoticeBtn);
  $("btnViewTerms")?.addEventListener("click", () => openSheet("legal"));
  $("btnNoticeContinue").addEventListener("click", () => {
    state.store.noticeAccepted = true;
    state.store.termsAccepted = true;
    saveStore();
    showGate(state.store.email ? "gateLogin" : "gateAccount");
  });

  function goOwnerGate() {
    $("ownerCode").value = "";
    showGate("gateOwner");
  }
  $("btnOwnerFromNotice")?.addEventListener("click", goOwnerGate);
  $("btnOwnerFromAccount")?.addEventListener("click", goOwnerGate);
  $("btnOwnerFromLogin")?.addEventListener("click", goOwnerGate);
  $("btnOwnerBack")?.addEventListener("click", () => {
    if (!state.store.noticeAccepted || !state.store.termsAccepted) showGate("gateNotice");
    else if (!state.store.email) showGate("gateAccount");
    else showGate("gateLogin");
  });
  $("btnOwnerUnlock")?.addEventListener("click", async () => {
    const code = $("ownerCode").value.trim();
    if (!code) { showStatus("×", true); return; }
    const hash = await sha256(`sweetdeck-owner:${code}`);
    if (hash !== OWNER_HASH) {
      showStatus(state.lang === "en" ? "Invalid code" : "Código incorrecto", true);
      return;
    }
    await activateOwnerMode();
  });
  $("ownerCode")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnOwnerUnlock").click();
  });

  $("btnCreateAccount").addEventListener("click", async () => {
    const firstName = $("regFirst").value.trim();
    const lastName = $("regLast").value.trim();
    const email = $("regEmail").value.trim().toLowerCase();
    const phone = $("regPhone").value.trim();
    const country = $("regCountry").value.trim();
    const pass = $("regPass").value;
    const pass2 = $("regPass2").value;
    if (!firstName || !lastName || !email.includes("@") || !phone || !country || pass.length < 6) {
      showStatus(state.lang === "en" ? "Complete all fields" : "Completa todos los campos", true);
      return;
    }
    if (pass !== pass2) { showStatus("≠", true); return; }
    const code = await codeForEmail(email);
    state.store = {
      ...state.store,
      firstName, lastName, email, phone, country,
      passHash: await sha256(`sweet:${email}:${pass}`),
      discountCode: code,
      discountEmail: email,
      discountAutoApply: true,
      createdAt: Date.now(),
      playlists: state.store.playlists || {},
      usage: state.usage,
    };
    saveStore();
    upsertBuyer({
      email, firstName, lastName, phone, country,
      discountCode: code,
      createdAt: state.store.createdAt,
      pro: !!state.isPro,
    });
    if (isEmailBanned(email)) {
      showBannedGate();
      return;
    }
    $("rewardEmail").textContent = email;
    $("discountCode").textContent = code;
    showGate("gateReward");
  });
  $("btnHaveAccount").addEventListener("click", () => showGate("gateLogin"));
  $("btnBackRegister").addEventListener("click", () => showGate("gateAccount"));
  $("btnLogin").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim().toLowerCase();
    const pass = $("loginPass").value;
    if (isEmailBanned(email)) {
      showBannedGate();
      return;
    }
    if (!state.store.email || state.store.email !== email) {
      showStatus(state.lang === "en" ? "Account not on this device" : "Cuenta no encontrada en este dispositivo", true);
      return;
    }
    const hash = await sha256(`sweet:${email}:${pass}`);
    if (hash !== state.store.passHash) { showStatus("×", true); return; }
    // Ensure code always matches email
    state.store.discountCode = await codeForEmail(email);
    state.store.discountEmail = email;
    state.store.discountAutoApply = true;
    saveStore();
    upsertBuyer({ email, discountCode: state.store.discountCode, pro: !!state.isPro });
    $("rewardEmail").textContent = email;
    $("discountCode").textContent = state.store.discountCode;
    showGate("gateReward");
  });
  $("btnCopyCode").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(state.store.discountCode || ""); showStatus("OK"); } catch {}
  });
  $("btnRewardContinue").addEventListener("click", () => showGate("gateSecure"));
  $("btnSaveSecure").addEventListener("click", async () => {
    const pin = $("setPin").value.trim();
    const pin2 = $("setPin2").value.trim();
    if (!/^\d{4,8}$/.test(pin) || pin !== pin2) { showStatus("PIN", true); return; }
    const pinId = state.store.email || "owner";
    state.store.pinHash = await sha256(`pin:${pinId}:${pin}`);
    if ($("enableBio").checked) await registerBio();
    else state.store.bioEnabled = false;
    saveStore();
    enterApp();
  });
  $("btnSkipSecure").addEventListener("click", () => enterApp());
  $("btnUnlock").addEventListener("click", async () => {
    const secret = $("unlockSecret").value;
    const pinId = state.store.email || "owner";
    const pinHash = await sha256(`pin:${pinId}:${secret}`);
    const passHash = state.store.email ? await sha256(`sweet:${state.store.email}:${secret}`) : "";
    if (secret && (pinHash === state.store.pinHash || (passHash && passHash === state.store.passHash))) enterApp();
    else showStatus("×", true);
  });
  $("btnBioUnlock").addEventListener("click", () => tryBioUnlock(false));

  // UI
  $("btnMenu").addEventListener("click", () => openMenu(true));
  $("btnCloseMenu").addEventListener("click", () => openMenu(false));
  $("menuBackdrop").addEventListener("click", () => openMenu(false));
  document.querySelectorAll(".menu-link[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openMenu(false);
      openSheet(btn.dataset.go);
    });
  });
  $("btnLockNow").addEventListener("click", () => { openMenu(false); lockApp(); });
  $("btnLang").addEventListener("click", () => setLang(state.lang === "es" ? "en" : "es"));

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tEl) => tEl.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`panel-${tab.dataset.tab}`).classList.add("active");
    });
  });

  $("btnImportFiles").addEventListener("click", () => $("fileInput").click());
  $("btnImportFolder").addEventListener("click", () => $("folderInput").click());
  $("fileInput").addEventListener("change", () => { addFiles($("fileInput").files); $("fileInput").value = ""; });
  $("folderInput").addEventListener("change", () => { addFiles($("folderInput").files); $("folderInput").value = ""; });
  $("btnClear").addEventListener("click", async () => {
    if (!state.tracks.length || !confirm("OK?")) return;
    audio.pause();
    const persistedIds = state.tracks.filter((tr) => tr.persisted).map((tr) => tr.id);
    state.tracks.forEach((tr) => URL.revokeObjectURL(tr.url));
    state.tracks = [];
    state.index = -1;
    rebuildOrder();
    setPlayingUI(false);
    updateNowPlaying();
    renderPlaylist();
    for (const id of persistedIds) {
      try { await mediaDelete(id); } catch { /* ignore */ }
    }
  });

  $("btnPlay").addEventListener("click", async () => {
    if (!state.tracks.length) { $("fileInput").click(); return; }
    await resumeCtx();
    if (audio.paused) { try { await audio.play(); setPlayingUI(true); } catch {} }
    else { audio.pause(); setPlayingUI(false); }
  });
  $("btnPrev").addEventListener("click", () => {
    if (!state.tracks.length) return;
    if (audio.currentTime > 3) audio.currentTime = 0;
    else playAt(state.index - 1);
  });
  $("btnNext").addEventListener("click", () => { if (state.tracks.length) playAt(state.index + 1); });
  $("btnShuffle").addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    $("btnShuffle").classList.toggle("on", state.shuffle);
    rebuildOrder();
  });
  $("btnRepeat").addEventListener("click", () => {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    $("btnRepeat").classList.toggle("on", state.repeat !== "off");
    $("btnRepeat").textContent = state.repeat === "one" ? "①" : "⟳";
  });

  $("seek").addEventListener("pointerdown", () => { state.seeking = true; });
  $("seek").addEventListener("pointerup", () => { state.seeking = false; });
  $("seek").addEventListener("input", () => {
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = (Number($("seek").value) / 1000) * audio.duration;
  });
  $("volume").addEventListener("input", () => { audio.volume = Number($("volume").value) / 100; });

  $("eqEnabled").addEventListener("change", async () => {
    if (!requirePro("EQ")) { $("eqEnabled").checked = false; return; }
    state.eqOn = $("eqEnabled").checked;
    ensureAudioGraph();
    await resumeCtx();
    applyGains(state.gains, $("eqPreset").value === "custom");
  });
  $("eqPreset").addEventListener("change", () => {
    if (!requirePro("EQ")) return;
    if ($("eqPreset").value === "custom") return;
    ensureAudioGraph();
    state.eqOn = true;
    $("eqEnabled").checked = true;
    applyGains(PRESETS[$("eqPreset").value] || PRESETS.flat, false);
  });

  $("karaokeOn").addEventListener("change", async () => {
    if (!state.isPro && state.usage.karaoke >= DEMO.karaoke && $("karaokeOn").checked) {
      $("karaokeOn").checked = false;
      showStatus("DEMO: 1 karaoke", true);
      return;
    }
    state.karaoke = $("karaokeOn").checked;
    if (state.karaoke && !state.isPro) { state.usage.karaoke += 1; saveStore(); refreshProUI(); }
    await resumeCtx();
    applyKaraokeMix();
  });
  $("btnFetchLyrics").addEventListener("click", fetchLyrics);

  $("btnImportVideo").addEventListener("click", () => $("videoInput").click());
  $("videoInput").addEventListener("change", () => {
    const file = $("videoInput").files?.[0];
    if (file) addFiles([file], { persist: true, source: "import" });
    $("videoInput").value = "";
  });
  $("btnUseCurrentVideo").addEventListener("click", () => {
    const track = state.tracks[state.index];
    if (!track || !isVideoTrack(track)) return;
    $("video").src = track.url;
    $("videoEmpty").classList.add("hidden");
  });

  $("btnRecAudio").addEventListener("click", () => startRecording("audio"));
  $("btnRecVideo").addEventListener("click", () => startRecording("video"));
  $("btnRecStop").addEventListener("click", () => stopRecording(true));

  $("btnNewPlaylist").addEventListener("click", () => {
    const name = $("playlistName").value.trim();
    if (!name) return;
    state.store.playlists = state.store.playlists || {};
    state.store.playlists[name] = state.store.playlists[name] || [];
    saveStore();
    $("playlistName").value = "";
    renderPlaylists();
  });

  audio.addEventListener("play", async () => { setPlayingUI(true); await resumeCtx(); });
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("ended", () => {
    if (state.repeat === "one") { audio.currentTime = 0; audio.play(); return; }
    if (state.index < state.tracks.length - 1) playAt(state.index + 1);
    else if (state.repeat === "all" && state.tracks.length) playAt(0);
    else setPlayingUI(false);
  });

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  buildEQ();
  drawVinyl();
  renderPlaylist();
  applyI18n();
  tick();
  (async () => {
    try { await restorePersistedMedia(); } catch (err) { console.warn("media restore failed", err); }
    await bootFlow();
  })();
})();
