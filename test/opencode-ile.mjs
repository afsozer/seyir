// Gerçek opencode + gerçek model ile tam zincir: `opencode run --standalone`
// geçici profilli test tarayıcısındaki eklentiyi kullanarak yerel bir formu
// doldurur. Modeli çağırır (opencode'un varsayılan modeli; birkaç kuruş).
//   node test/opencode-ile.mjs [provider/model]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { KOK, duzenekKur } from "./duzenek.mjs";

let gelenAd = null;
const sunucu = http.createServer((q, y) => {
  const u = new URL(q.url, "http://x");
  y.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (u.pathname === "/gonder") {
    gelenAd = u.searchParams.get("ad");
    return y.end(`<title>Sonuç</title><h1>Teşekkürler ${gelenAd}</h1><p>Onay kodu: K-7319</p>`);
  }
  y.end(`<title>Başvuru</title><h1>Başvuru formu</h1>
    <form action="/gonder"><label>Ad <input name="ad"></label> <button>Gönder</button></form>`);
});
await new Promise((r) => sunucu.listen(0, "127.0.0.1", r));
const ADRES = `http://127.0.0.1:${sunucu.address().port}/`;

const { kapat, soketler } = await duzenekKur({ etiket: "opencode-e2e" });
const istem =
  `tarayici araçlarıyla ${ADRES} adresini yeni sekmede aç, "Ad" alanına "Deneme" yaz, Gönder'e bas. ` +
  `Açılan sayfadaki onay kodunu bana söyle, sonra sekmeyi kapat. Başka araç kullanma.`;
const args = ["run", "--standalone", "--title", "tarayici e2e", ...(process.argv[2] ? ["-m", process.argv[2]] : []), istem];
const oc = spawn("opencode", args, {
  cwd: KOK,
  env: { ...process.env, OCT_SOKET_DIZINI: soketler, OCT_ETIKET: "opencode-e2e", OCT_DEBUG: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let cikti = "";
oc.stdout.on("data", (d) => process.stdout.write((cikti += d, d)));
oc.stderr.on("data", (d) => process.stderr.write(d));
const zaman = setTimeout(() => oc.kill(), 240000);
const kod = await new Promise((r) => oc.on("exit", r));
clearTimeout(zaman);

try {
  assert.equal(kod, 0, "opencode çıkış kodu " + kod);
  assert.equal(gelenAd, "Deneme", "form sunucuya 'Deneme' ile gelmedi");
  assert.match(cikti, /K-7319/, "model onay kodunu söylemedi");
  console.log("\nOPENCODE İLE: TAMAM (form gönderildi, onay kodu okundu)");
} catch (e) {
  console.error("\nBAŞARISIZ:", e.message);
  process.exitCode = 1;
} finally {
  kapat();
  sunucu.close();
  setTimeout(() => process.exit(), 700);
}
