// Seyir — service worker.
// Akış: opencode MCP (mcp/server.mjs) ⇄ Unix soketi ⇄ native host (host/host.mjs,
// tarayıcı başlatır) ⇄ bu dosya ⇄ chrome.tabs / tabGroups / debugger (CDP).
// Her opencode konuşması bir "oturum"dur ve ilk sekmesinde kendi grubunu açar. Ajan yalnız
// kendi grubundaki sekmelere ve kullanıcının popup'tan paylaştığı sekmelere dokunur.
import { sayfa } from "./sayfa.js";

const HOST = "com.sozer.opencode_tarayici";
const RENKLER = ["orange", "blue", "green", "purple", "cyan", "pink", "yellow", "red"];
const BOSTA_AYIR_MS = 5 * 60 * 1000; // bu kadar dokunulmayan sekmeden debugger ayrılır

let port = null;
let hostHazir = false; // host ilk mesajını gönderdi mi (port açılması tek başına yetmez)
let hostHatasi = null;
let yenidenDene = null;

// Kalıcı durum: service worker uyuyup uyansa da (tarayıcı kapanana dek) kalır.
let durum = { oturumlar: {}, paylasilan: [], duraklatildi: false, renkSira: 0 };
const hazir = chrome.storage.session
  .get("durum")
  .then((x) => {
    if (x.durum) durum = { ...durum, ...x.durum };
  })
  .catch(() => {});
function kaydet() {
  chrome.storage.session.set({ durum }).catch(() => {});
  rozet();
}

// Debugger'a bağlı sekmeler: tabId → { son, konsol, ag, bildirim, olcek, diyalogKabul }
const bagli = new Map();

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const kisalt = (s, n = 120) => {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

// ---------------------------------------------------------------- host bağlantısı

function baglan() {
  if (port) return;
  clearTimeout(yenidenDene);
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    hostHatasi = e.message;
    rozet();
    return;
  }
  port.onMessage.addListener(hostMesaji);
  port.onDisconnect.addListener(() => {
    hostHatasi = chrome.runtime.lastError?.message || "host kapandı";
    hostHazir = false;
    // Tanı için diske de yaz (profilin Local Extension Settings'inden okunabilir).
    chrome.storage.local.set({ sonHostHatasi: `${new Date().toISOString()} ${hostHatasi}` }).catch(() => {});
    port = null;
    rozet();
    // Host kurulu değilse sık denemenin anlamı yok; alarm dakikada bir yoklar.
    if (!/not found|forbidden/i.test(hostHatasi)) yenidenDene = setTimeout(baglan, 3000);
  });
  hostHatasi = null;
  chrome.storage.local.set({ sonBaglanma: new Date().toISOString() }).catch(() => {});
  port.postMessage({ tur: "merhaba", surum: chrome.runtime.getManifest().version });
  rozet();
}

function gonder(m) {
  try {
    port?.postMessage(m);
  } catch {}
}

async function hostMesaji(m) {
  await hazir;
  if (!hostHazir) {
    hostHazir = true;
    rozet();
  }
  switch (m.tur) {
    case "istek": {
      try {
        const sonuc = await isle(m.oturum, m.arac, m.args || {}, m.etiket);
        gonder({ tur: "yanit", id: m.id, sonuc });
      } catch (e) {
        gonder({ tur: "hata", id: m.id, mesaj: e?.message || String(e) });
      }
      break;
    }
    case "oturum_bitti":
      await bitir(m.oturum);
      break;
    case "canli": {
      // Host yeniden başladığında geri gelmeyen MCP süreçlerinin oturumlarını kapat.
      const canli = new Set(m.oturumlar || []);
      for (const [k, o] of Object.entries(durum.oturumlar))
        if (!o.bitti && !canli.has(k) && Date.now() - (o.son || 0) > 30000) await bitir(k);
      break;
    }
    case "ping":
      gonder({ tur: "pong" });
      break;
  }
}

// ---------------------------------------------------------------- oturumlar ve gruplar

function oturumAl(k) {
  let o = durum.oturumlar[k];
  if (!o) {
    o = durum.oturumlar[k] = {
      etiket: "",
      grupId: null,
      renk: RENKLER[durum.renkSira++ % RENKLER.length],
      bitti: false,
      son: Date.now(),
    };
    kaydet();
  }
  return o;
}

function grupAdi(o) {
  if (o.bitti) return `✓ ${o.etiket || "opencode"}`;
  return o.etiket ? `opencode · ${o.etiket}` : "opencode";
}

async function grupGecerli(o) {
  if (o.grupId == null) return null;
  try {
    return await chrome.tabGroups.get(o.grupId);
  } catch {
    o.grupId = null;
    kaydet();
    return null;
  }
}

async function bitir(k) {
  const o = durum.oturumlar[k];
  if (!o) return;
  o.bitti = true;
  const g = await grupGecerli(o);
  if (g) {
    const sekmeler = await chrome.tabs.query({ groupId: g.id });
    for (const t of sekmeler) ayir(t.id);
    await chrome.tabGroups.update(g.id, { title: grupAdi(o), color: "grey" }).catch(() => {});
  }
  delete durum.oturumlar[k];
  kaydet();
}

async function oturumSekmeleri(o) {
  const liste = [];
  if (await grupGecerli(o)) liste.push(...(await chrome.tabs.query({ groupId: o.grupId })));
  for (const id of durum.paylasilan) {
    if (liste.some((t) => t.id === id)) continue;
    try {
      liste.push({ ...(await chrome.tabs.get(id)), paylasilan: true });
    } catch {}
  }
  return liste;
}

async function sekmeDogrula(o, tabId) {
  if (typeof tabId !== "number") throw new Error("tabId gerekli; sekmeleri tabs_context ile gör.");
  let t;
  try {
    t = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(`Sekme ${tabId} yok (kapanmış olabilir). tabs_context ile bak.`);
  }
  if (durum.paylasilan.includes(tabId)) return t;
  if (o.grupId != null && t.groupId === o.grupId) return t;
  throw new Error(
    `Sekme ${tabId} bu oturumun grubunda değil. Yalnız tabs_create ile açtığın ya da kullanıcının paylaştığı sekmeleri kullanabilirsin.`
  );
}

function urlDuzelt(u) {
  u = String(u || "").trim();
  if (!u) throw new Error("url boş.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0|[^/]+\.(test|localhost))(:\d+)?(\/|$)/i.test(u)) return "http://" + u;
  return "https://" + u;
}

function yuklenmeBekle(tabId, ms) {
  return new Promise((coz) => {
    let bitti = false;
    const son = (v) => {
      if (bitti) return;
      bitti = true;
      chrome.tabs.onUpdated.removeListener(dinle);
      clearTimeout(z);
      coz(v);
    };
    const dinle = (id, deg) => {
      if (id === tabId && deg.status === "complete") son(true);
    };
    chrome.tabs.onUpdated.addListener(dinle);
    const z = setTimeout(() => son(false), ms);
  });
}

async function yukleniyorsaBekle(tabId, ms) {
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (t?.status === "loading") await yuklenmeBekle(tabId, ms);
}

// ---------------------------------------------------------------- CDP

function cdp(tabId, method, params = {}, sure = 20000) {
  return Promise.race([
    chrome.debugger.sendCommand({ tabId }, method, params),
    bekle(sure).then(() => {
      throw new Error(`${method} ${sure / 1000} sn içinde yanıt vermedi.`);
    }),
  ]);
}

async function hataAyikla(tabId) {
  const var_ = bagli.get(tabId);
  if (var_) {
    var_.son = Date.now();
    return var_;
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    if (!/already attached/i.test(e.message))
      throw new Error(
        `Sekmeye bağlanamadım: ${e.message}. (chrome://, brave://, eklenti mağazası ve başka eklenti sayfaları kontrol edilemez.)`
      );
  }
  const k = { son: Date.now(), konsol: [], ag: new Map(), bildirim: [], olcek: 1, diyalogKabul: 0 };
  bagli.set(tabId, k);
  await Promise.all(
    [
      cdp(tabId, "Page.enable"),
      cdp(tabId, "Runtime.enable"),
      cdp(tabId, "Log.enable"),
      cdp(tabId, "Network.enable", { maxTotalBufferSize: 10_000_000 }),
      cdp(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }),
    ].map((p) => p.catch(() => {}))
  );
  return k;
}

function ayir(tabId) {
  if (!bagli.has(tabId)) return;
  bagli.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
}

function konsolEkle(k, seviye, metin, yer) {
  k.konsol.push({ zaman: Date.now(), seviye, metin: kisalt(metin, 2000), yer });
  if (k.konsol.length > 500) k.konsol.shift();
}

function argMetin(a) {
  if (a.type === "string") return a.value;
  if ("value" in a) return JSON.stringify(a.value);
  return a.description || a.unserializableValue || a.type;
}

chrome.debugger.onEvent.addListener((kaynak, method, p) => {
  const k = bagli.get(kaynak.tabId);
  if (!k) return;
  switch (method) {
    case "Runtime.consoleAPICalled": {
      const f = p.stackTrace?.callFrames?.[0];
      konsolEkle(k, p.type, (p.args || []).map(argMetin).join(" "), f ? `${f.url}:${f.lineNumber + 1}` : "");
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = p.exceptionDetails || {};
      konsolEkle(k, "exception", d.exception?.description || d.text, d.url ? `${d.url}:${(d.lineNumber ?? 0) + 1}` : "");
      break;
    }
    case "Log.entryAdded":
      konsolEkle(k, p.entry.level, p.entry.text, p.entry.url || "");
      break;
    case "Network.requestWillBeSent":
      k.ag.set(p.requestId, {
        id: p.requestId,
        yontem: p.request.method,
        url: p.request.url,
        tur: p.type || "",
        zaman: Date.now(),
      });
      if (k.ag.size > 500) k.ag.delete(k.ag.keys().next().value);
      break;
    case "Network.responseReceived": {
      const r = k.ag.get(p.requestId);
      if (r) {
        r.durum = p.response.status;
        r.mime = p.response.mimeType;
      }
      break;
    }
    case "Network.loadingFailed": {
      const r = k.ag.get(p.requestId);
      if (r) r.hata = p.canceled ? "iptal" : p.errorText;
      break;
    }
    case "Page.javascriptDialogOpening": {
      // Diyalog açıkken sayfa donar; bekletmeyiz. Varsayılan: alert kabul, gerisi
      // (confirm/prompt/beforeunload) iptal. Ajan accept_dialog verdiyse kabul.
      const kabul = p.type === "alert" || Date.now() - k.diyalogKabul < 15000;
      k.diyalogKabul = 0;
      cdp(kaynak.tabId, "Page.handleJavaScriptDialog", { accept: kabul, promptText: p.defaultPrompt || "" }).catch(() => {});
      k.bildirim.push(`Sayfa bir ${p.type} diyaloğu açtı ("${kisalt(p.message)}") → ${kabul ? "kabul edildi" : "iptal edildi"}.`);
      break;
    }
  }
});

chrome.debugger.onDetach.addListener((kaynak, neden) => {
  bagli.delete(kaynak.tabId);
  if (neden === "canceled_by_user") {
    // Kullanıcı "hata ayıklama" şeridinde İptal'e bastı: bunu dur sinyali say.
    durum.duraklatildi = true;
    for (const id of [...bagli.keys()]) ayir(id);
    kaydet();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  bagli.delete(tabId);
  if (durum.paylasilan.includes(tabId)) {
    durum.paylasilan = durum.paylasilan.filter((x) => x !== tabId);
    kaydet();
  }
});

async function sayfadaCalistir(tabId, islem, p = {}) {
  let r;
  try {
    [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: sayfa, args: [islem, p] });
  } catch (e) {
    throw new Error(`Sayfada çalıştıramadım: ${e.message}`);
  }
  const v = r?.result;
  if (v?.hata) throw new Error(v.hata);
  if (v === undefined || v === null) throw new Error("Sayfadan yanıt gelmedi (sayfa yükleniyor olabilir; biraz sonra tekrar dene).");
  return v;
}

// Her eylem sonucunun sonuna sekmenin güncel hâlini ve diyalog bildirimlerini ekler.
async function ozet(tabId, metin) {
  const k = bagli.get(tabId);
  const ek = k?.bildirim.splice(0) || [];
  const t = await chrome.tabs.get(tabId).catch(() => null);
  const satir = t ? `\n[sekme ${tabId}] ${kisalt(t.title, 80)} — ${t.url}` : "";
  return { metin: metin + (ek.length ? "\n" + ek.join("\n") : "") + satir };
}

// ---------------------------------------------------------------- klavye

const TUSLAR = {
  enter: ["Enter", "Enter", 13, "\r"],
  return: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9],
  escape: ["Escape", "Escape", 27],
  esc: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8],
  delete: ["Delete", "Delete", 46],
  space: [" ", "Space", 32, " "],
  arrowup: ["ArrowUp", "ArrowUp", 38],
  up: ["ArrowUp", "ArrowUp", 38],
  arrowdown: ["ArrowDown", "ArrowDown", 40],
  down: ["ArrowDown", "ArrowDown", 40],
  arrowleft: ["ArrowLeft", "ArrowLeft", 37],
  left: ["ArrowLeft", "ArrowLeft", 37],
  arrowright: ["ArrowRight", "ArrowRight", 39],
  right: ["ArrowRight", "ArrowRight", 39],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
};
for (let i = 1; i <= 12; i++) TUSLAR["f" + i] = ["F" + i, "F" + i, 111 + i];
const MOD = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
const MAC_KOMUT = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo" };

function tusCoz(ifade) {
  const parca = ifade.split("+").map((s) => s.trim()).filter(Boolean);
  let mod = 0;
  const ana = parca.pop();
  for (const m of parca) {
    if (!(m.toLowerCase() in MOD)) throw new Error(`Bilinmeyen değiştirici tuş: ${m}`);
    mod |= MOD[m.toLowerCase()];
  }
  let key, code, vk, text;
  const tanim = TUSLAR[ana.toLowerCase()];
  if (tanim) [key, code, vk, text] = tanim;
  else if (ana.length === 1) {
    key = mod & 8 ? ana.toUpperCase() : ana;
    const b = ana.toUpperCase();
    if (/[A-Z]/.test(b)) [code, vk] = ["Key" + b, b.charCodeAt(0)];
    else if (/[0-9]/.test(b)) [code, vk] = ["Digit" + b, b.charCodeAt(0)];
    else [code, vk] = ["", 0];
    text = key;
  } else throw new Error(`Bilinmeyen tuş: ${ana}`);
  const kisayol = (mod & 4) || (mod & 2);
  const komut = mod & 4 && ana.length === 1 ? (mod & 8 && ana.toLowerCase() === "z" ? "redo" : MAC_KOMUT[ana.toLowerCase()]) : null;
  return { key, code, vk, text: kisayol ? undefined : text, mod, komut };
}

async function tusBas(tabId, ifade) {
  const t = tusCoz(ifade);
  const ortak = { key: t.key, code: t.code, windowsVirtualKeyCode: t.vk, nativeVirtualKeyCode: t.vk, modifiers: t.mod };
  await cdp(tabId, "Input.dispatchKeyEvent", {
    ...ortak,
    type: t.text ? "keyDown" : "rawKeyDown",
    text: t.text,
    unmodifiedText: t.text,
    commands: t.komut ? [t.komut] : undefined,
  });
  await cdp(tabId, "Input.dispatchKeyEvent", { ...ortak, type: "keyUp" });
}

// ---------------------------------------------------------------- ekran görüntüsü

async function base64(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ekranAl(tabId, k) {
  const m = await cdp(tabId, "Page.getLayoutMetrics");
  const vv = m.cssVisualViewport || m.visualViewport;
  const gw = Math.round(vv.clientWidth);
  const gh = Math.round(vv.clientHeight);
  const r = await cdp(tabId, "Page.captureScreenshot", { format: "png" }, 15000);
  const olcek = Math.min(1, 1280 / gw);
  const w = Math.round(gw * olcek);
  const h = Math.round(gh * olcek);
  const bmp = await createImageBitmap(await (await fetch("data:image/png;base64," + r.data)).blob());
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const jpeg = await c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  k.olcek = olcek;
  return { w, h, gw, gh, olcek, data: await base64(jpeg) };
}

// ---------------------------------------------------------------- araçlar

const ARACLAR = {
  async tabs_context(o) {
    const s = await oturumSekmeleri(o);
    const g = await grupGecerli(o);
    const bas = `Oturum: ${grupAdi(o)}${g ? ` (grup ${g.id}, ${g.color})` : " (henüz sekme grubu yok)"}`;
    if (!s.length) return { metin: `${bas}\nKontrol ettiğin sekme yok. tabs_create ile aç.` };
    return {
      metin:
        `${bas}\n` +
        s
          .map(
            (t) =>
              `- tabId ${t.id}${t.active ? " [etkin]" : ""}${t.paylasilan ? " (kullanıcı paylaştı)" : ""} ${JSON.stringify(kisalt(t.title, 80))} — ${t.url}`
          )
          .join("\n"),
    };
  },

  async tabs_create(o, a) {
    const url = a.url ? urlDuzelt(a.url) : "about:blank";
    let pencere = (await grupGecerli(o))?.windowId;
    let t;
    if (pencere == null) {
      const w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
      pencere = w?.id;
    }
    if (pencere == null) {
      const w = await chrome.windows.create({ url, focused: false });
      t = w.tabs[0];
      pencere = w.id;
    } else t = await chrome.tabs.create({ windowId: pencere, url, active: true });
    if (o.grupId != null) await chrome.tabs.group({ groupId: o.grupId, tabIds: [t.id] });
    else {
      o.grupId = await chrome.tabs.group({ tabIds: [t.id], createProperties: { windowId: pencere } });
      await chrome.tabGroups.update(o.grupId, { title: grupAdi(o), color: o.renk, collapsed: false });
    }
    kaydet();
    if (a.url) {
      await hataAyikla(t.id).catch(() => {});
      await yukleniyorsaBekle(t.id, 30000);
    }
    return ozet(t.id, `Yeni sekme açıldı: tabId ${t.id}.`);
  },

  async tabs_close(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    if (durum.paylasilan.includes(t.id))
      throw new Error("Bu sekmeyi kullanıcı paylaştı; kapatamazsın. Gerekirse kullanıcıdan iste.");
    ayir(t.id);
    await chrome.tabs.remove(t.id);
    return { metin: `Sekme ${t.id} kapatıldı.` };
  },

  async navigate(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const k = await hataAyikla(t.id).catch(() => null);
    if (k && a.accept_dialog) k.diyalogKabul = Date.now();
    const bitis = yuklenmeBekle(t.id, 30000);
    if (a.url === "back" || a.url === "forward") {
      // chrome.tabs.goBack, kullanıcı etkileşimi görmemiş girdileri atlar (Chrome'un
      // geçmiş müdahalesi); ajanın gezindiği sayfalar hep öyle. CDP ile doğrudan git.
      if (!k) throw new Error("Sekmeye bağlanılamadı.");
      const { currentIndex, entries } = await cdp(t.id, "Page.getNavigationHistory");
      const hedef = entries[currentIndex + (a.url === "back" ? -1 : 1)];
      if (!hedef) throw new Error(a.url === "back" ? "Geri gidilecek sayfa yok." : "İleri gidilecek sayfa yok.");
      await cdp(t.id, "Page.navigateToHistoryEntry", { entryId: hedef.id });
    } else if (a.url === "reload") await chrome.tabs.reload(t.id);
    else await chrome.tabs.update(t.id, { url: urlDuzelt(a.url) });
    const tamam = await bitis;
    return ozet(t.id, tamam ? "Sayfa yüklendi." : "Yükleme 30 sn içinde bitmedi; sayfa hâlâ yükleniyor olabilir.");
  },

  async read_page(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    await yukleniyorsaBekle(t.id, 10000);
    const r = await sayfadaCalistir(t.id, "oku", {
      filtre: a.filter === "interactive" ? "interactive" : "all",
      kok: a.ref_id,
      maxKarakter: a.max_chars || 20000,
    });
    return ozet(t.id, r.metin);
  },

  async find(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const r = await sayfadaCalistir(t.id, "bul", { sorgu: a.query, limit: a.limit });
    return ozet(t.id, r.metin);
  },

  async get_page_text(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    await yukleniyorsaBekle(t.id, 10000);
    const r = await sayfadaCalistir(t.id, "metin", { kok: a.ref_id, tumSayfa: !!a.whole_page, maxKarakter: a.max_chars });
    return { metin: r.metin };
  },

  async click(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const k = await hataAyikla(t.id);
    let x;
    let y;
    let not = "";
    if (a.ref) {
      const h = await sayfadaCalistir(t.id, "hedef", { ref: a.ref });
      ({ x, y } = h);
      if (h.kaplayan) not = `\nUyarı: bu noktada üstte başka öğe var: ${h.kaplayan}. Tık ona gitmiş olabilir.`;
    } else if (typeof a.x === "number" && typeof a.y === "number") {
      x = a.x / (k.olcek || 1);
      y = a.y / (k.olcek || 1);
    } else throw new Error("ref ya da x,y ver.");
    if (a.accept_dialog) k.diyalogKabul = Date.now();
    const tus = a.button === "right" ? "right" : a.button === "middle" ? "middle" : "left";
    const mod = (a.modifiers || []).reduce((m, s) => m | (MOD[String(s).toLowerCase()] || 0), 0);
    const adet = a.clicks === 3 ? 3 : a.clicks === 2 ? 2 : 1;
    await cdp(t.id, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: mod });
    for (let i = 1; i <= adet; i++) {
      await cdp(t.id, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: tus, clickCount: i, modifiers: mod });
      await cdp(t.id, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: tus, clickCount: i, modifiers: mod });
    }
    await bekle(350);
    await yukleniyorsaBekle(t.id, 15000);
    return ozet(t.id, `Tıklandı${a.ref ? " " + a.ref : ""} (${Math.round(x)},${Math.round(y)} CSS px).${not}`);
  },

  async hover(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const k = await hataAyikla(t.id);
    let x;
    let y;
    if (a.ref) ({ x, y } = await sayfadaCalistir(t.id, "hedef", { ref: a.ref }));
    else if (typeof a.x === "number" && typeof a.y === "number") [x, y] = [a.x / k.olcek, a.y / k.olcek];
    else throw new Error("ref ya da x,y ver.");
    await cdp(t.id, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await bekle(300);
    return ozet(t.id, `İmleç ${Math.round(x)},${Math.round(y)} üzerinde.`);
  },

  async type(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const k = await hataAyikla(t.id);
    let not = "";
    if (a.ref) {
      const r = await sayfadaCalistir(t.id, "odakla", { ref: a.ref, temizle: !!a.clear });
      if (!r.odakta) not = `\nUyarı: ${r.tanim} odak almadı; yazı başka yere gitmiş olabilir.`;
    }
    if (a.text) await cdp(t.id, "Input.insertText", { text: String(a.text) });
    if (a.submit) {
      if (a.accept_dialog) k.diyalogKabul = Date.now();
      await tusBas(t.id, "Enter");
      await bekle(350);
      await yukleniyorsaBekle(t.id, 15000);
    }
    return ozet(t.id, `Yazıldı (${String(a.text || "").length} karakter)${a.submit ? " ve Enter'a basıldı" : ""}.${not}`);
  },

  async press_key(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const k = await hataAyikla(t.id);
    if (a.accept_dialog) k.diyalogKabul = Date.now();
    const dizi = String(a.keys || "").split(/\s+/).filter(Boolean);
    if (!dizi.length) throw new Error("keys boş.");
    const tekrar = Math.min(Math.max(a.repeat || 1, 1), 50);
    for (let i = 0; i < tekrar; i++) for (const d of dizi) await tusBas(t.id, d);
    await bekle(250);
    await yukleniyorsaBekle(t.id, 15000);
    return ozet(t.id, `Basıldı: ${dizi.join(" ")}${tekrar > 1 ? ` ×${tekrar}` : ""}.`);
  },

  async form_input(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const r = await sayfadaCalistir(t.id, "deger", { ref: a.ref, deger: a.value });
    return ozet(t.id, "Ayarlandı: " + r.metin);
  },

  async scroll(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    await hataAyikla(t.id);
    let m;
    if (a.to === "top" || a.to === "bottom") m = await sayfadaCalistir(t.id, "kaydir", { nereye: a.to });
    else {
      let x;
      let y;
      if (a.ref) ({ x, y } = await sayfadaCalistir(t.id, "hedef", { ref: a.ref }));
      else {
        const u = await sayfadaCalistir(t.id, "olcu");
        [x, y] = [u.w / 2, u.h / 2];
      }
      const n = Math.min(Math.max(a.amount ?? 5, 1), 30);
      const [dx, dy] = { down: [0, 1], up: [0, -1], right: [1, 0], left: [-1, 0] }[a.direction || "down"] || [0, 1];
      await cdp(t.id, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx * n * 100, deltaY: dy * n * 100 });
      await bekle(400);
      m = await sayfadaCalistir(t.id, "olcu");
    }
    return ozet(t.id, `Kaydırıldı. Sayfa konumu y=${m.sy}/${m.maxY}${m.maxX ? `, x=${m.sx}/${m.maxX}` : ""}.`);
  },

  async screenshot(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    if (!t.active) {
      // Arka plandaki sekme çizilmez; görüntü için öne getir.
      await chrome.tabs.update(t.id, { active: true });
      await bekle(300);
    }
    const k = await hataAyikla(t.id);
    let g;
    try {
      g = await ekranAl(t.id, k);
    } catch (e) {
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      await bekle(500);
      g = await ekranAl(t.id, k);
    }
    const r = await ozet(
      t.id,
      `Ekran görüntüsü ${g.w}x${g.h}` +
        (g.olcek < 1 ? ` (görünüm ${g.gw}x${g.gh} CSS px, ölçek ${g.olcek.toFixed(3)})` : "") +
        `. click/hover'a x,y verirsen bu görüntünün piksellerini kullan; ref varsa ref daha güvenilir.`
    );
    return { ...r, gorsel: { data: g.data, mimeType: "image/jpeg" } };
  },

  async javascript(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    await hataAyikla(t.id);
    const r = await cdp(
      t.id,
      "Runtime.evaluate",
      { expression: String(a.code || ""), replMode: true, awaitPromise: true, returnByValue: true, userGesture: true },
      Math.min((a.timeout || 30) * 1000, 120000)
    );
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("Sayfa hatası: " + (d.exception?.description || d.text));
    }
    const v = r.result;
    let s;
    if (v.type === "undefined") s = "undefined";
    else if ("value" in v) s = typeof v.value === "string" ? v.value : JSON.stringify(v.value, null, 2);
    else s = v.description || v.type;
    const max = a.max_chars || 20000;
    if (s.length > max) s = s.slice(0, max) + `\n… (kesildi: ${s.length} karakter)`;
    return ozet(t.id, s);
  },

  async console_messages(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const k = await hataAyikla(t.id);
    let l = k.konsol;
    if (a.only_errors) l = l.filter((m) => ["error", "exception", "assert"].includes(m.seviye));
    if (a.pattern) l = l.filter((m) => m.metin.includes(a.pattern));
    l = l.slice(-(a.limit || 50));
    if (a.clear) k.konsol = [];
    if (!l.length)
      return { metin: "Konsol mesajı yok. (Kayıt, sekmeye ilk bağlanıldığı andan itibaren tutulur; gerekirse navigate reload yap.)" };
    return {
      metin: l
        .map((m) => `[${new Date(m.zaman).toISOString().slice(11, 19)}] ${m.seviye}: ${m.metin}${m.yer ? `  (${m.yer})` : ""}`)
        .join("\n"),
    };
  },

  async network_requests(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    const k = await hataAyikla(t.id);
    if (a.request_id) {
      const r = await cdp(t.id, "Network.getResponseBody", { requestId: a.request_id }).catch((e) => {
        throw new Error(`Yanıt gövdesi alınamadı: ${e.message}`);
      });
      let s = r.base64Encoded ? `(ikili veri, ${Math.round((r.body.length * 3) / 4)} bayt)` : r.body;
      const max = a.max_chars || 20000;
      if (s.length > max) s = s.slice(0, max) + `\n… (kesildi: ${s.length} karakter)`;
      return { metin: s };
    }
    let l = [...k.ag.values()];
    if (a.url_pattern) l = l.filter((r) => r.url.includes(a.url_pattern));
    if (a.only_failed) l = l.filter((r) => r.hata || r.durum >= 400);
    l = l.slice(-(a.limit || 50));
    if (a.clear) k.ag.clear();
    if (!l.length) return { metin: "Ağ isteği yok. (Kayıt, sekmeye ilk bağlanıldığı andan itibaren tutulur.)" };
    return {
      metin: l
        .map((r) => `${r.id} ${r.yontem} ${r.durum ?? (r.hata ? "HATA" : "…")} ${r.tur} ${kisalt(r.url, 200)}${r.hata ? ` (${r.hata})` : ""}`)
        .join("\n"),
    };
  },

  async wait_for(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    if (!a.text && !a.selector) {
      const sn = Math.min(Math.max(a.seconds ?? 2, 0), 30);
      await bekle(sn * 1000);
      return ozet(t.id, `${sn} sn beklendi.`);
    }
    const son = Date.now() + Math.min(a.timeout ?? 10, 60) * 1000;
    const ne = [a.text && `metin "${a.text}"`, a.selector && `seçici ${a.selector}`].filter(Boolean).join(" + ");
    while (true) {
      let var_ = false;
      try {
        var_ = (await sayfadaCalistir(t.id, "kontrol", { metin: a.text, secici: a.selector })).var;
      } catch {}
      if (var_ !== !!a.gone) return ozet(t.id, a.gone ? `${ne} kayboldu.` : `${ne} göründü.`);
      if (Date.now() > son) return ozet(t.id, `Zaman aşımı: ${ne} ${a.gone ? "hâlâ duruyor" : "görünmedi"}.`);
      await bekle(400);
    }
  },

  async upload_file(o, a) {
    const t = await sekmeDogrula(o, a.tabId);
    await hataAyikla(t.id);
    const yollar = Array.isArray(a.paths) ? a.paths : [a.paths];
    const { isaret, coklu } = await sayfadaCalistir(t.id, "dosya_isaretle", { ref: a.ref });
    if (yollar.length > 1 && !coklu) throw new Error("Bu alan tek dosya alıyor.");
    try {
      const { root } = await cdp(t.id, "DOM.getDocument", { depth: 0 });
      const { nodeId } = await cdp(t.id, "DOM.querySelector", { nodeId: root.nodeId, selector: `[data-oct-yukle="${isaret}"]` });
      if (!nodeId) throw new Error("Dosya alanı DOM'da bulunamadı (shadow DOM içinde olabilir).");
      await cdp(t.id, "DOM.setFileInputFiles", { nodeId, files: yollar });
    } finally {
      await sayfadaCalistir(t.id, "dosya_temizle", { isaret }).catch(() => {});
    }
    return ozet(t.id, `Yüklendi: ${yollar.map((y) => y.split("/").pop()).join(", ")}`);
  },
};

async function isle(oturum, arac, args, etiket) {
  await hazir;
  if (durum.duraklatildi)
    throw new Error(
      "Kullanıcı Seyir'i duraklattı (eklenti simgesi → Devam). Kullanıcıya sor; kendi başına yeniden deneme."
    );
  const f = ARACLAR[arac];
  if (!f) throw new Error(`Bilinmeyen araç: ${arac}`);
  const o = oturumAl(oturum);
  o.son = Date.now();
  if (etiket && !o.etiket) o.etiket = etiket;
  if (o.bitti) {
    o.bitti = false;
    kaydet();
  }
  return f(o, args);
}

// ---------------------------------------------------------------- rozet ve popup

function rozet() {
  const aktif = Object.values(durum.oturumlar).filter((o) => !o.bitti && o.grupId != null).length;
  let metin = "";
  let renk = "#d97706";
  let baslik = "Seyir";
  if (!port || !hostHazir) {
    metin = "!";
    renk = "#b91c1c";
    baslik += ` — köprü bağlı değil (${hostHatasi || (port ? "host yanıt bekleniyor" : "?")})`;
  } else if (durum.duraklatildi) {
    metin = "II";
    renk = "#6b7280";
    baslik += " — duraklatıldı";
  } else if (aktif) {
    metin = String(aktif);
    baslik += ` — ${aktif} oturum`;
  }
  chrome.action.setBadgeText({ text: metin }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: renk }).catch(() => {});
  chrome.action.setTitle({ title: baslik }).catch(() => {});
}

chrome.runtime.onMessage.addListener((m, _g, yanit) => {
  (async () => {
    await hazir;
    if (m.tur === "paylas") {
      const var_ = durum.paylasilan.includes(m.tabId);
      durum.paylasilan = var_ ? durum.paylasilan.filter((x) => x !== m.tabId) : [...durum.paylasilan, m.tabId];
      if (var_) ayir(m.tabId);
      kaydet();
    } else if (m.tur === "duraklat") {
      durum.duraklatildi = !!m.deger;
      if (durum.duraklatildi) for (const id of [...bagli.keys()]) ayir(id);
      kaydet();
    } else if (m.tur === "yeniden_baglan") baglan();
    const oturumlar = [];
    for (const o of Object.values(durum.oturumlar)) {
      const sekme = (await grupGecerli(o)) ? (await chrome.tabs.query({ groupId: o.grupId })).length : 0;
      oturumlar.push({ ad: grupAdi(o), renk: o.renk, sekme, bitti: o.bitti });
    }
    yanit({
      bagli: !!port && hostHazir,
      hostHatasi,
      duraklatildi: durum.duraklatildi,
      paylasilan: durum.paylasilan,
      oturumlar,
      kimlik: chrome.runtime.id,
    });
  })();
  return true;
});

// ---------------------------------------------------------------- yaşam döngüsü

chrome.alarms.create("oct-nabiz", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "oct-nabiz") return;
  baglan();
  for (const [id, k] of bagli) if (Date.now() - k.son > BOSTA_AYIR_MS) ayir(id);
  oturumTemizle();
});

// opencode konuşmaları açıkça "bitmez"; bir saattir dokunulmamış ve grubu
// kalmamış (sekmeleri kapatılmış) oturum kayıtlarını at.
async function oturumTemizle() {
  await hazir;
  let degisti = false;
  for (const [k, o] of Object.entries(durum.oturumlar)) {
    if (Date.now() - (o.son || 0) < 3600_000) continue;
    if (await grupGecerli(o)) continue;
    delete durum.oturumlar[k];
    degisti = true;
  }
  if (degisti) kaydet();
}
chrome.runtime.onStartup.addListener(baglan);
chrome.runtime.onInstalled.addListener(baglan);
hazir.then(() => {
  baglan();
  rozet();
});
