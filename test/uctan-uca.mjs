// Uçtan uca test: gerçek eklentiyi geçici profilli Chrome for Testing'e yükler
// (test/duzenek.mjs) ve MCP üzerinden yerel bir test sayfasını sürer.
//   node test/uctan-uca.mjs            # görünmez (headless)
//   OCT_GORUNUR=1 node test/uctan-uca.mjs
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { KOK, bekle, duzenekKur } from "./duzenek.mjs";

// ---- test sayfası
const SAYFA = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Test Sayfası</title></head><body>
<main>
  <h1>Deneme Formu</h1>
  <label for="ad">Ad Soyad</label> <input id="ad" placeholder="Adınız">
  <select id="sehir" aria-label="Şehir"><option>Ankara</option><option value="20">Denizli</option><option>İzmir</option></select>
  <label><input type="checkbox" id="onay"> Kabul ediyorum</label>
  <textarea id="not" aria-label="Not"></textarea>
  <button id="gonder" onclick="sonuc.textContent = [ad.value, sehir.value, onay.checked, not.value].join('|')">Gönder</button>
  <div id="sonuc"></div>
  <div id="kart" style="cursor:pointer" onmousedown="this.dataset.t='evet'"><span>İLETİŞİM kartı</span></div>
  <input type="file" id="dosya" aria-label="Belge">
  <button id="onayla" onclick="sonuc2.textContent = confirm('Emin misin?') ? 'onaylandı' : 'reddedildi'">Onayla</button>
  <div id="sonuc2"></div>
  <button id="gec" onclick="setTimeout(() => { const p = document.createElement('p'); p.textContent = 'Geç gelen içerik'; document.body.append(p) }, 800)">Gecikmeli</button>
  <a href="/ikinci">İkinci sayfa</a>
  <div style="height:3000px"></div><footer>Son</footer>
</main>
<script>
  window.girdi = 0; ad.addEventListener('input', () => window.girdi++);
  console.log('merhaba konsol'); console.error('bilerek hata');
  fetch('/api/veri').then(r => r.json()).then(j => console.log('api', j.x));
</script></body></html>`;
const sunucu = http.createServer((q, y) => {
  if (q.url === "/api/veri") return y.writeHead(200, { "content-type": "application/json" }).end('{"x":42}');
  if (q.url === "/ikinci") return y.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>İkinci</title><h1>İkinci sayfa</h1>");
  y.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SAYFA);
});
await new Promise((r) => sunucu.listen(0, "127.0.0.1", r));
const ADRES = `http://127.0.0.1:${sunucu.address().port}/`;

const { arac, kapat } = await duzenekKur({ etiket: "e2e" });
console.log("✓ eklenti yüklendi, host native messaging ile başladı");
function bitir(kod) {
  kapat();
  sunucu.close();
  setTimeout(() => process.exit(kod), 600);
}

try {
  const refBul = (metin, desen) => {
    const s = metin.split("\n").find((l) => desen.test(l));
    assert.ok(s, `satır yok: ${desen}\n${metin}`);
    return s.match(/\[(ref_\d+)\]/)[1];
  };
  const js = async (tabId, code) => (await arac("javascript", { tabId, code })).metin.split("\n[sekme")[0];

  let { metin } = await arac("tabs_context");
  assert.match(metin, /Kontrol ettiğin sekme yok/);

  ({ metin } = await arac("tabs_create", { url: ADRES }));
  const tabId = Number(metin.match(/tabId (\d+)/)[1]);
  assert.match(metin, /Test Sayfası/);
  ({ metin } = await arac("tabs_context"));
  assert.match(metin, /opencode · e2e \(grup \d+, orange\)/);
  assert.match(metin, new RegExp(`tabId ${tabId} \\[etkin\\]`));
  console.log("✓ tabs_create: sekme grubu 'opencode · e2e' turuncu açıldı");

  ({ metin } = await arac("read_page", { tabId, filter: "interactive" }));
  const refAd = refBul(metin, /textbox "Ad Soyad"/);
  const refSehir = refBul(metin, /combobox "Şehir".*options=\[Ankara \| Denizli \| İzmir\]/);
  const refOnay = refBul(metin, /checkbox "Kabul ediyorum"/);
  const refNot = refBul(metin, /textbox "Not"/);
  const refGonder = refBul(metin, /button "Gönder"/);
  const refDosya = refBul(metin, /file "Belge"/);
  refBul(metin, /heading "Deneme Formu" level=1/);
  refBul(metin, /link "İkinci sayfa" href="\/ikinci"/);
  refBul(metin, /clickable "İLETİŞİM kartı"/);
  ({ metin: metin } = await arac("read_page", { tabId }));
  assert.match(metin, /- text "Son"|contentinfo "Son"|contentinfo/);
  console.log("✓ read_page: roller, adlar, ref'ler doğru");

  await arac("type", { tabId, ref: refAd, text: "Fatih Sözer" });
  await arac("form_input", { tabId, ref: refSehir, value: "Denizli" });
  await arac("form_input", { tabId, ref: refOnay, value: true });
  await arac("form_input", { tabId, ref: refNot, value: "ilk not" });
  ({ metin } = await arac("click", { tabId, ref: refGonder }));
  assert.equal(await js(tabId, "sonuc.textContent"), "Fatih Sözer|20|true|ilk not");
  assert.ok(Number(await js(tabId, "window.girdi")) >= 1, "input olayı tetiklenmedi");
  console.log("✓ type + form_input + click: form gönderildi");

  ({ metin } = await arac("read_page", { tabId, filter: "interactive" }));
  assert.match(metin, /textbox "Ad Soyad" value="Fatih Sözer"/);
  assert.match(metin, /checkbox "Kabul ediyorum" checked/);
  assert.ok(metin.includes(`[${refAd}]`), "ref'ler okumalar arasında sabit kalmadı");

  ({ metin } = await arac("find", { tabId, query: "iletişim" }));
  const refKart = refBul(metin, /İLETİŞİM kartı/);
  await arac("click", { tabId, ref: refKart });
  assert.equal(await js(tabId, "kart.dataset.t"), "evet");
  console.log("✓ find (Türkçe büyük/küçük harf duyarsız) + tıklanabilir div");

  await arac("click", { tabId, ref: refAd });
  await arac("press_key", { tabId, keys: "cmd+a Backspace" });
  assert.equal(await js(tabId, "ad.value"), "");
  await arac("type", { tabId, ref: refAd, text: "ikinci", clear: true });
  assert.equal(await js(tabId, "ad.value"), "ikinci");
  console.log("✓ press_key (cmd+a Backspace) + type clear");

  ({ metin } = await arac("click", { tabId, ref: refBul((await arac("find", { tabId, query: "Onayla" })).metin, /button "Onayla"/) }));
  assert.match(metin, /confirm diyaloğu açtı \("Emin misin\?"\) → iptal edildi/);
  assert.equal(await js(tabId, "sonuc2.textContent"), "reddedildi");
  await arac("click", { tabId, ref: refBul((await arac("find", { tabId, query: "Onayla" })).metin, /button "Onayla"/), accept_dialog: true });
  assert.equal(await js(tabId, "sonuc2.textContent"), "onaylandı");
  console.log("✓ diyaloglar: varsayılan iptal, accept_dialog ile kabul");

  await arac("click", { tabId, ref: refBul((await arac("find", { tabId, query: "Gecikmeli" })).metin, /button "Gecikmeli"/) });
  ({ metin } = await arac("wait_for", { tabId, text: "geç gelen içerik", timeout: 5 }));
  assert.match(metin, /göründü/);
  console.log("✓ wait_for");

  await arac("upload_file", { tabId, ref: refDosya, paths: [path.join(KOK, "README.md")] });
  assert.equal(await js(tabId, "dosya.files[0]?.name"), "README.md");
  console.log("✓ upload_file");

  ({ metin } = await arac("scroll", { tabId, direction: "down", amount: 5 }));
  assert.ok(Number(metin.match(/y=(\d+)/)[1]) > 0, "kaydırılmadı: " + metin);
  ({ metin } = await arac("scroll", { tabId, to: "bottom" }));
  console.log("✓ scroll");

  const { r: ekran } = await arac("screenshot", { tabId });
  assert.equal(ekran.content[1].type, "image");
  assert.ok(ekran.content[1].data.startsWith("/9j/"), "JPEG değil");
  const [gw] = ekran.content[0].text.match(/(\d+)x(\d+)/).slice(1).map(Number);
  assert.ok(gw > 200 && gw <= 1280, "genişlik tuhaf: " + gw);
  console.log("✓ screenshot:", ekran.content[0].text.split("\n")[0]);

  await arac("navigate", { tabId, url: "reload" });
  await bekle(500);
  ({ metin } = await arac("console_messages", { tabId }));
  assert.match(metin, /log: merhaba konsol/);
  assert.match(metin, /error: bilerek hata/);
  assert.match(metin, /api 42/);
  ({ metin } = await arac("network_requests", { tabId, url_pattern: "/api/veri" }));
  const istekId = metin.trim().split(/\s/)[0];
  assert.match(metin, /GET 200 Fetch/);
  ({ metin } = await arac("network_requests", { tabId, request_id: istekId }));
  assert.equal(metin, '{"x":42}');
  console.log("✓ console_messages + network_requests (+ yanıt gövdesi)");

  ({ metin } = await arac("get_page_text", { tabId }));
  assert.match(metin, /Deneme Formu/);
  ({ metin } = await arac("navigate", { tabId, url: ADRES + "ikinci" }));
  assert.match(metin, /İkinci/);
  ({ metin } = await arac("read_page", { tabId: tabId, ref_id: refAd }, true));
  assert.match(metin, /sayfada yok/);
  ({ metin } = await arac("navigate", { tabId, url: "back" }));
  assert.match(metin, /Test Sayfası/);
  ({ metin } = await arac("navigate", { tabId, url: "forward" }));
  assert.match(metin, /İkinci/);
  await arac("navigate", { tabId, url: "back" });
  console.log("✓ navigate (url/back/forward) + eski ref'ler geçersiz");

  // İkinci konuşma: ayrı grup, ayrı renk; birbirinin sekmesine dokunamaz.
  const B = { "ai.opencode/sessionID": "ses_ikinci" };
  ({ metin } = await arac("tabs_create", { url: ADRES + "ikinci" }, false, B));
  const tabB = Number(metin.match(/tabId (\d+)/)[1]);
  ({ metin } = await arac("tabs_context", {}, false, B));
  assert.match(metin, /opencode · e2e \(grup \d+, blue\)/);
  assert.ok(!metin.includes(`tabId ${tabId}`), "ikinci konuşma birincinin sekmesini görüyor");
  ({ metin } = await arac("read_page", { tabId }, true, B));
  assert.match(metin, /bu oturumun grubunda değil/);
  ({ metin } = await arac("read_page", { tabId: tabB }, true));
  assert.match(metin, /bu oturumun grubunda değil/);
  await arac("tabs_close", { tabId: tabB }, false, B);
  console.log("✓ konuşma başına sekme grubu (turuncu/mavi) ve izolasyon");

  ({ metin } = await arac("read_page", { tabId: 999999 }, true));
  assert.match(metin, /Sekme 999999 yok/);
  ({ metin } = await arac("javascript", { tabId, code: "throw new Error('kasıtlı')" }, true));
  assert.match(metin, /kasıtlı/);

  ({ metin } = await arac("tabs_close", { tabId }));
  assert.match(metin, /kapatıldı/);
  ({ metin } = await arac("tabs_context"));
  assert.match(metin, /Kontrol ettiğin sekme yok/);
  console.log("✓ hata yolları + tabs_close");

  console.log("\nUÇTAN UCA: TAMAM");
  bitir(0);
} catch (e) {
  console.error("\nBAŞARISIZ:", e.message);
  bitir(1);
}
