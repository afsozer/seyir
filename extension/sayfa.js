// Sayfaya enjekte edilen tek fonksiyon. chrome.scripting.executeScript bunu
// kaynak metin olarak kopyalar: dış kapsamdaki hiçbir şeye erişemez, her
// yardımcı içeride tanımlı. Durum (ref haritası) eklentinin izole dünyasında
// globalThis.__oct'ta yaşar; sayfa yenilenince kendiliğinden silinir, eski
// ref'ler de böylece geçersiz olur.
export function sayfa(islem, p = {}) {
  const d = (globalThis.__oct ??= { sira: 0, elden: new WeakMap(), refden: new Map() });

  function refVer(el) {
    let r = d.elden.get(el);
    if (!r) {
      r = "ref_" + ++d.sira;
      d.elden.set(el, r);
      d.refden.set(r, new WeakRef(el));
    }
    return r;
  }
  function elBul(ref) {
    const el = d.refden.get(String(ref))?.deref();
    if (!el || !el.isConnected)
      throw new Error(`${ref} sayfada yok (sayfa değişmiş ya da yenilenmiş olabilir); read_page ya da find ile yeniden oku.`);
    return el;
  }
  function kisalt(s, n = 100) {
    s = String(s ?? "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function tirnak(s) {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }

  const INPUT_ROL = {
    checkbox: "checkbox", radio: "radio", button: "button", submit: "button", reset: "button",
    image: "button", range: "slider", search: "searchbox", file: "file", number: "spinbutton",
    color: "button",
  };
  const ETIKET_ROL = {
    BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", IMG: "img", NAV: "navigation",
    MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", FORM: "form", TABLE: "table", TR: "row",
    TD: "cell", TH: "columnheader", UL: "list", OL: "list", LI: "listitem", DIALOG: "dialog",
    SUMMARY: "button", DETAILS: "group", OPTION: "option", ARTICLE: "article", ASIDE: "complementary",
    LABEL: "label", LEGEND: "legend", IFRAME: "iframe", FRAME: "iframe", VIDEO: "video", AUDIO: "audio",
    PROGRESS: "progressbar", METER: "meter", FIELDSET: "group",
  };
  const ETKILESIMLI = new Set([
    "link", "button", "textbox", "searchbox", "combobox", "checkbox", "radio", "slider", "switch",
    "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "spinbutton",
    "file", "listbox",
  ]);
  // Adını içeriğinden alan roller: satırda metin zaten görünür, içindeki
  // düz metni ayrıca yazmayız (yalnız içteki etkileşimli öğeleri).
  const ICERIKTEN_AD = new Set([
    "link", "button", "heading", "option", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
    "treeitem", "switch", "checkbox", "radio", "legend", "clickable",
  ]);
  // Etkileşimli torunu yoksa içeriğiyle birlikte tek satır yazılanlar.
  const YAPRAK_ADAY = new Set(["cell", "columnheader", "rowheader", "listitem", "label", "paragraph"]);
  const YAPISAL = new Set([
    "heading", "img", "navigation", "main", "banner", "contentinfo", "form", "table", "row", "cell",
    "columnheader", "rowheader", "list", "listitem", "dialog", "alertdialog", "alert", "region",
    "article", "complementary", "iframe", "group", "label", "legend", "video", "audio", "progressbar",
    "meter", "status", "tablist", "tabpanel", "menu", "menubar", "toolbar", "search", "grid", "tree",
  ]);
  const ETK_SECICI =
    'a[href],button,input,select,textarea,summary,[role],[tabindex],[contenteditable=""],[contenteditable="true"],[onclick]';
  const HEDEF_SECICI = 'a[href],button,input,select,textarea,[role=button],[role=link],[contenteditable="true"]';

  function rol(el) {
    const r = el.getAttribute("role");
    if (r) return r.trim().split(/\s+/)[0];
    const t = el.tagName;
    if (t === "A") return el.hasAttribute("href") ? "link" : null;
    if (t === "INPUT") {
      const ty = (el.getAttribute("type") || "text").toLowerCase();
      if (ty === "hidden") return null;
      return INPUT_ROL[ty] || "textbox";
    }
    if (/^H[1-6]$/.test(t)) return "heading";
    if (t === "SECTION") return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : null;
    if (t === "P") return "paragraph";
    if (el.isContentEditable && el.hasAttribute("contenteditable")) return "textbox";
    return ETIKET_ROL[t] || null;
  }

  // Sezgiyle "clickable" sayılan ama çok metin taşıyan kart: adı içerikten
  // alınmaz, içeriği de yutulmaz (metin alt satırlarda görünsün).
  function uzunKart(el, r) {
    return r === "clickable" && (el.innerText || "").length > 100;
  }

  // Erişilebilir ad: sırayla ilk dolu aday (her aday kırpılarak denenir;
  // yalnız boşluktan oluşan içerik "dolu" sayılmaz).
  function ad(el, r) {
    const t = el.tagName;
    const adaylar = [
      () => el.getAttribute("aria-label"),
      () => {
        const ids = el.getAttribute("aria-labelledby");
        return ids && ids.split(/\s+/).map((i) => document.getElementById(i)?.innerText || "").join(" ");
      },
      () => t !== "LABEL" && el.labels?.length && [...el.labels].map((l) => l.innerText).join(" "),
      () => (t === "IMG" || t === "AREA") && el.getAttribute("alt"),
      () => t === "INPUT" && ["submit", "button", "reset", "image"].includes(el.type) && (el.value || el.getAttribute("alt")),
      () => ICERIKTEN_AD.has(r) && !uzunKart(el, r) && (el.innerText || el.textContent),
      () => el.getAttribute("title"),
      () => el.getAttribute("placeholder"),
      // Yalnız ikon/resim içeren link ve düğmeler: içteki resmin adı.
      () => {
        if (!ICERIKTEN_AD.has(r)) return "";
        const i = el.querySelector("img[alt]:not([alt='']), [aria-label], svg title, [title]");
        return i && (i.getAttribute("alt") || i.getAttribute("aria-label") || i.getAttribute("title") || i.textContent);
      },
      () => r === "iframe" && el.getAttribute("name"),
    ];
    for (const a of adaylar) {
      const s = kisalt(a() || "");
      if (s) return s;
    }
    return "";
  }

  function ekler(el, r) {
    const e = [];
    const t = el.tagName;
    if (r === "heading") e.push(`level=${/^H[1-6]$/.test(t) ? t[1] : el.getAttribute("aria-level") || "?"}`);
    if (r === "link") {
      const h = el.getAttribute("href");
      if (h && !/^javascript:/i.test(h)) e.push(`href=${tirnak(kisalt(h, 90))}`);
    }
    if (t === "INPUT" || t === "TEXTAREA") {
      const ty = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "INPUT" && !["text", "checkbox", "radio", "submit", "button"].includes(ty)) e.push(`type=${ty}`);
      if (el.value && !["checkbox", "radio", "submit", "button", "reset", "image", "file"].includes(ty))
        e.push(`value=${tirnak(ty === "password" ? "••••" : kisalt(el.value, 80))}`);
      if (ty === "file" && el.files?.length) e.push(`dosyalar=${tirnak([...el.files].map((f) => f.name).join(", "))}`);
      if (el.getAttribute("placeholder") && ad(el, r) !== kisalt(el.getAttribute("placeholder")))
        e.push(`placeholder=${tirnak(kisalt(el.getAttribute("placeholder"), 60))}`);
      if (el.required) e.push("required");
    }
    if (t === "SELECT") {
      const sec = [...el.selectedOptions].map((o) => kisalt(o.text, 40));
      if (sec.length) e.push(`value=${tirnak(sec.join(", "))}`);
      const hepsi = [...el.options].map((o) => kisalt(o.text, 30));
      e.push(`options=[${hepsi.slice(0, 25).join(" | ")}${hepsi.length > 25 ? ` | …+${hepsi.length - 25}` : ""}]`);
    }
    if (el.isContentEditable && el.hasAttribute("contenteditable")) {
      const v = kisalt(el.innerText, 80);
      if (v) e.push(`value=${tirnak(v)}`);
    }
    if (el.checked === true || el.getAttribute("aria-checked") === "true") e.push("checked");
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") e.push("disabled");
    const gen = el.getAttribute("aria-expanded");
    if (gen) e.push(`expanded=${gen}`);
    if (el.getAttribute("aria-selected") === "true") e.push("selected");
    if (r === "iframe") e.push(`src=${tirnak(kisalt(el.getAttribute("src") || "", 90))} (içi okunmadı)`);
    return e.length ? " " + e.join(" ") : "";
  }

  function cocuklari(el) {
    if (el.tagName === "SLOT") {
      const a = el.assignedNodes({ flatten: true });
      return a.length ? a : [...el.childNodes];
    }
    if (el.shadowRoot) return [...el.shadowRoot.childNodes];
    return [...el.childNodes];
  }

  // Sayfayı gezip {derinlik, metin, ref} kayıtları üretir.
  function agac({ filtre = "all", kok = null, maxDugum = 6000, metinRefi = false }) {
    const kayit = [];
    let dugum = 0;
    let tasti = false;
    const sadeceEtk = filtre === "interactive";

    function gez(n, derinlik, yutuldu) {
      if (tasti) return;
      if (++dugum > maxDugum) {
        tasti = true;
        return;
      }
      if (n.nodeType === 3) {
        if (sadeceEtk || yutuldu) return;
        const t = kisalt(n.data, 300);
        if (t) kayit.push({ derinlik, metin: `- text ${tirnak(t)}`, ref: metinRefi && n.parentElement ? refVer(n.parentElement) : null });
        return;
      }
      if (n.nodeType === 11) {
        for (const c of n.childNodes) gez(c, derinlik, yutuldu);
        return;
      }
      if (n.nodeType !== 1) return;
      const el = n;
      const t = el.tagName;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "BR", "WBR"].includes(t)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none") return;
      const saydam = cs.display === "contents";
      if (!saydam && (cs.visibility === "hidden" || cs.visibility === "collapse")) return;
      if (el.getAttribute("aria-hidden") === "true" || el.hidden) return;
      if (t === "SVG" || t === "svg") {
        const a = el.getAttribute("aria-label") || el.querySelector?.("title")?.textContent;
        if (a && !sadeceEtk && !yutuldu) kayit.push({ derinlik, metin: `- img ${tirnak(kisalt(a))} [${refVer(el)}]`, ref: refVer(el) });
        return;
      }
      let r = rol(el);
      if (r === "presentation" || r === "none" || r === "generic") r = null;
      let etk = (r && ETKILESIMLI.has(r)) || t === "SUMMARY" || el.hasAttribute("onclick");
      if (!etk) {
        const ti = el.getAttribute("tabindex");
        if (ti !== null && +ti >= 0 && t !== "IFRAME") etk = true;
      }
      if (!etk && !r && cs.cursor === "pointer" && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer"))
        etk = true;
      // Anlamsal rolü olmayan öğe (tabindex/onclick/cursor:pointer sezgisi) içinde
      // gerçek hedef (link/düğme/alan) varsa kapsayıcıdır, hedef değil; yoksa bütün
      // bir kart/panel "clickable" olup içeriğini yutar.
      if (etk && !r && el.querySelector(HEDEF_SECICI)) etk = false;
      if (etk && !r) r = "clickable";
      if (t === "IMG" && !etk && !el.getAttribute("alt")) return;

      let yaz = false;
      let yaprak = false;
      if (etk) yaz = true;
      else if (r === "heading") yaz = !yutuldu;
      else if (!sadeceEtk && !yutuldu && r && YAPISAL.has(r)) {
        // Adsız bölge/grup/liste satırı bilgi taşımaz; içerik bir üst düzeyde akar.
        yaz = ["region", "group", "list", "listitem"].includes(r) ? !!el.getAttribute("aria-label") || (r !== "list" && r !== "listitem" && !!ad(el, r)) : true;
      }
      if (!sadeceEtk && !yutuldu && r && YAPRAK_ADAY.has(r) && !el.querySelector(ETK_SECICI)) {
        const m = kisalt(el.innerText, 300);
        if (m) {
          yaz = true;
          yaprak = true;
        }
      }

      let sonrakiDerinlik = derinlik;
      let yut = yutuldu;
      if (yaz) {
        const ref = refVer(el);
        const adi = yaprak ? kisalt(el.innerText, 300) : ad(el, r);
        const gorunenRol = yaprak && r === "paragraph" ? "text" : r;
        kayit.push({
          derinlik,
          metin: `- ${gorunenRol}${adi ? " " + tirnak(adi) : ""}${ekler(el, r)} [${ref}]`,
          ref,
        });
        if (!sadeceEtk) sonrakiDerinlik = derinlik + 1;
        if (yaprak || (ICERIKTEN_AD.has(r) && !uzunKart(el, r)) || t === "SELECT") yut = true;
      }
      if (t === "SELECT" || r === "iframe") return;
      for (const c of cocuklari(el)) gez(c, sonrakiDerinlik, yut);
    }

    const baslangic = kok ? elBul(kok) : document.body || document.documentElement;
    gez(baslangic, 0, false);
    return { kayit, tasti };
  }

  function normal(s) {
    return String(s)
      .toLocaleLowerCase("tr")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i");
  }

  function derinEleman(x, y) {
    let e = document.elementFromPoint(x, y);
    while (e?.shadowRoot) {
      const i = e.shadowRoot.elementFromPoint(x, y);
      if (!i || i === e) break;
      e = i;
    }
    return e;
  }
  function icerir(a, b) {
    for (let n = b; n; n = n.parentNode || n.host) if (n === a) return true;
    return false;
  }
  function tanim(el) {
    if (!el) return "?";
    const r = rol(el);
    const a = ad(el, r);
    return `<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}>${a ? " " + tirnak(a) : ""}`;
  }
  function olcu() {
    const se = document.scrollingElement || document.documentElement;
    return {
      w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
      sx: Math.round(scrollX), sy: Math.round(scrollY),
      maxY: Math.max(0, Math.round(se.scrollHeight - innerHeight)),
      maxX: Math.max(0, Math.round(se.scrollWidth - innerWidth)),
    };
  }
  function alanGuncelle(el, deger) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, deger);
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  try {
    switch (islem) {
      case "oku": {
        const { kayit, tasti } = agac({ filtre: p.filtre, kok: p.kok, maxDugum: p.maxDugum || 6000 });
        const o = olcu();
        const bas = [
          `Sayfa: ${document.title}`,
          `URL: ${location.href}`,
          `Görünüm ${o.w}x${o.h}, kaydırma y=${o.sy}/${o.maxY}`,
          "",
        ];
        const satirlar = [];
        let uzunluk = bas.join("\n").length;
        let kesildi = tasti;
        for (const k of kayit) {
          const s = "  ".repeat(k.derinlik) + k.metin;
          if (uzunluk + s.length + 1 > (p.maxKarakter || 20000)) {
            kesildi = true;
            break;
          }
          satirlar.push(s);
          uzunluk += s.length + 1;
        }
        if (!satirlar.length) satirlar.push("(görünür öğe yok)");
        if (kesildi) satirlar.push("… (kesildi: sınıra ulaşıldı; bir bölgeye odaklanmak için ref_id ver ya da find kullan)");
        return { metin: bas.join("\n") + satirlar.join("\n") };
      }
      case "bul": {
        const q = normal(p.sorgu || "");
        if (!q) throw new Error("Aranacak metin boş.");
        const { kayit } = agac({ filtre: "all", maxDugum: 20000, metinRefi: true });
        const es = kayit.filter((k) => normal(k.metin).includes(q)).slice(0, p.limit || 25);
        const satir = es.map((k) => k.metin + (k.metin.endsWith("]") || !k.ref ? "" : ` [${k.ref}]`));
        return { metin: satir.length ? `${satir.length} eşleşme:\n${satir.join("\n")}` : `"${p.sorgu}" bulunamadı.` };
      }
      case "hedef": {
        const el = elBul(p.ref);
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        let rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) rect = el.getClientRects()[0] || rect;
        if (!rect.width && !rect.height) throw new Error(`${p.ref} görünür bir alan kaplamıyor (gizli olabilir).`);
        const noktalar = [
          [0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75],
        ].map(([a, b]) => [rect.left + rect.width * a, rect.top + rect.height * b]);
        for (const [x, y] of noktalar) {
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const e = derinEleman(x, y);
          if (e && (icerir(el, e) || icerir(e, el))) return { x, y };
        }
        const [x, y] = noktalar[0];
        return { x, y, kaplayan: tanim(derinEleman(x, y)) };
      }
      case "odakla": {
        const el = elBul(p.ref);
        el.scrollIntoView({ block: "center", behavior: "instant" });
        el.focus();
        if (p.temizle) {
          if (typeof el.select === "function" && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) el.select();
          else if (el.isContentEditable) {
            const s = getSelection();
            const r = document.createRange();
            r.selectNodeContents(el);
            s.removeAllRanges();
            s.addRange(r);
          }
        }
        const aktif = document.activeElement;
        return { odakta: aktif === el || icerir(el, aktif), tanim: tanim(el) };
      }
      case "deger": {
        const el = elBul(p.ref);
        const v = p.deger;
        if (el.tagName === "SELECT") {
          const hedefler = Array.isArray(v) ? v.map(String) : [String(v)];
          const eslesen = [...el.options].filter((o) => hedefler.some((h) => o.value === h || normal(o.text.trim()) === normal(h.trim())));
          if (!eslesen.length) throw new Error(`Seçenek yok: ${hedefler.join(", ")}. Mevcut: ${[...el.options].map((o) => o.text.trim()).slice(0, 40).join(" | ")}`);
          for (const o of el.options) o.selected = el.multiple ? eslesen.includes(o) : o === eslesen[0];
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { metin: `${tanim(el)} → ${[...el.selectedOptions].map((o) => o.text.trim()).join(", ")}` };
        }
        if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
          const ist = v === true || v === "true" || v === 1 || v === "1" || v === "on";
          if (el.checked !== ist) el.click();
          return { metin: `${tanim(el)} → ${el.checked ? "işaretli" : "işaretsiz"}` };
        }
        if (el.getAttribute("role") === "checkbox" || el.getAttribute("role") === "switch") {
          const ist = v === true || v === "true";
          if ((el.getAttribute("aria-checked") === "true") !== ist) el.click();
          return { metin: `${tanim(el)} → aria-checked=${el.getAttribute("aria-checked")}` };
        }
        if (el.tagName === "INPUT" && el.type === "file") throw new Error("Dosya alanı: upload_file aracını kullan.");
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
          el.focus();
          alanGuncelle(el, String(v));
          return { metin: `${tanim(el)} → ${tirnak(kisalt(el.type === "password" ? "••••" : el.value, 80))}` };
        }
        if (el.isContentEditable) throw new Error("Düzenlenebilir alan (contenteditable): type aracını kullan (ref + clear=true).");
        throw new Error(`${tanim(el)} bir form alanı değil.`);
      }
      case "metin": {
        const kok = p.kok ? elBul(p.kok) : document.querySelector("main, [role=main], article") || document.body;
        const tum = p.tumSayfa ? document.body : kok;
        const m = (tum?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
        const max = p.maxKarakter || 30000;
        return {
          metin: `Sayfa: ${document.title}\nURL: ${location.href}\n\n${m.length > max ? m.slice(0, max) + `\n… (kesildi: ${m.length} karakterin ${max}'i)` : m || "(metin yok)"}`,
        };
      }
      case "kontrol": {
        let var_ = true;
        if (p.metin) var_ = normal(document.body?.innerText || "").includes(normal(p.metin));
        if (var_ && p.secici) {
          const el = document.querySelector(p.secici);
          var_ = !!el && (!el.checkVisibility || el.checkVisibility());
        }
        return { var: var_ };
      }
      case "olcu":
        return olcu();
      case "kaydir": {
        const se = document.scrollingElement || document.documentElement;
        if (p.nereye === "top") scrollTo({ top: 0, behavior: "instant" });
        else if (p.nereye === "bottom") scrollTo({ top: se.scrollHeight, behavior: "instant" });
        return olcu();
      }
      case "dosya_isaretle": {
        let el = elBul(p.ref);
        if (!(el.tagName === "INPUT" && el.type === "file"))
          el = el.control || el.querySelector?.('input[type="file"]') || el.closest?.("label")?.control || el;
        if (!(el.tagName === "INPUT" && el.type === "file"))
          throw new Error(`${p.ref} bir dosya alanı (input type=file) değil. read_page'de rolü "file" olan öğeyi ver.`);
        const isaret = "y" + Math.random().toString(36).slice(2);
        el.setAttribute("data-oct-yukle", isaret);
        return { isaret, coklu: el.multiple };
      }
      case "dosya_temizle": {
        document.querySelector(`[data-oct-yukle="${p.isaret}"]`)?.removeAttribute("data-oct-yukle");
        return {};
      }
      default:
        throw new Error("Bilinmeyen sayfa işlemi: " + islem);
    }
  } catch (e) {
    return { hata: e?.message || String(e) };
  }
}
