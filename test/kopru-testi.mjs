// Köprü testi: gerçek tarayıcı olmadan host + MCP sunucusunu uçtan uca sınar.
// Host'u tarayıcı gibi başlatır (stdio, uzunluk önekli JSON), eklentiyi taklit
// eder, MCP sunucusuna opencode gibi JSON-RPC gönderir.
//   node test/kopru-testi.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KOK = path.resolve(new URL("..", import.meta.url).pathname);
const DIZIN = fs.mkdtempSync(path.join(os.tmpdir(), "oct-test-"));
const env = { ...process.env, OCT_SOKET_DIZINI: DIZIN, OCT_ETIKET: "deneme" };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- sahte eklenti
const host = spawn(process.execPath, [path.join(KOK, "host/host.mjs")], { env, stdio: ["pipe", "pipe", "inherit"] });
const eklentiGelen = [];
let tampon = Buffer.alloc(0);
function eklentidenGonder(m) {
  const g = Buffer.from(JSON.stringify(m));
  const b = Buffer.alloc(4);
  b.writeUInt32LE(g.length);
  host.stdin.write(Buffer.concat([b, g]));
}
host.stdout.on("data", (p) => {
  tampon = Buffer.concat([tampon, p]);
  while (tampon.length >= 4) {
    const n = tampon.readUInt32LE(0);
    if (tampon.length < 4 + n) break;
    const m = JSON.parse(tampon.subarray(4, 4 + n));
    tampon = tampon.subarray(4 + n);
    eklentiGelen.push(m);
    if (m.tur !== "istek") continue;
    if (m.arac === "find" && m.args.query === "hata") eklentidenGonder({ tur: "hata", id: m.id, mesaj: "bilerek hata" });
    else if (m.arac === "screenshot")
      eklentidenGonder({ tur: "yanit", id: m.id, sonuc: { metin: "ekran", gorsel: { data: Buffer.from("jpeg-yerine").toString("base64"), mimeType: "image/jpeg" } } });
    else eklentidenGonder({ tur: "yanit", id: m.id, sonuc: { metin: `${m.arac} ${JSON.stringify(m.args)} oturum=${m.oturum} etiket=${m.etiket}` } });
  }
});
eklentidenGonder({ tur: "merhaba", surum: "test" });
for (let i = 0; i < 50 && !fs.readdirSync(DIZIN).some((a) => a.endsWith(".sock")); i++) await bekle(50);
assert.ok(fs.readdirSync(DIZIN).some((a) => a.endsWith(".sock")), "host soketi oluşmadı");
assert.equal(fs.statSync(DIZIN).mode & 0o777, 0o700, "soket dizini 0700 değil");

// ---- opencode yerine MCP istemcisi
const mcp = spawn(process.execPath, [path.join(KOK, "mcp/server.mjs")], { env, stdio: ["pipe", "pipe", "inherit"] });
const yanitlar = new Map();
let girdi = "";
mcp.stdout.setEncoding("utf8");
mcp.stdout.on("data", (p) => {
  girdi += p;
  let i;
  while ((i = girdi.indexOf("\n")) >= 0) {
    const m = JSON.parse(girdi.slice(0, i));
    girdi = girdi.slice(i + 1);
    yanitlar.get(m.id)?.(m);
  }
});
let sira = 0;
function rpc(method, params) {
  const id = ++sira;
  return new Promise((coz) => {
    yanitlar.set(id, coz);
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const cagir = (name, args, _meta) => rpc("tools/call", { name, arguments: args, _meta }).then((m) => m.result);

const ilk = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
assert.equal(ilk.result.protocolVersion, "2025-06-18");
mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const liste = (await rpc("tools/list")).result.tools;
assert.ok(liste.length >= 18, "araç sayısı az: " + liste.length);
for (const a of liste) assert.equal(a.inputSchema.type, "object", a.name);
console.log("araçlar:", liste.map((a) => a.name).join(", "));

const r1 = await cagir("tabs_context", {});
assert.match(r1.content[0].text, /^tabs_context \{\} oturum=[0-9a-f-]{36} etiket=deneme$/);
const oturum = r1.content[0].text.match(/oturum=(\S+)/)[1];

// opencode konuşma kimliği gelirse oturum odur (konuşma başına sekme grubu).
const rK = await cagir("tabs_context", {}, { "ai.opencode/sessionID": "ses_konusma1", progressToken: 9 });
assert.match(rK.content[0].text, /oturum=ses_konusma1 etiket=deneme/);

const r2 = await cagir("screenshot", { tabId: 1 });
assert.equal(r2.content[1].type, "image");
assert.match(r2.content[0].text, /Dosya: .*\.jpg/);

const r3 = await cagir("find", { tabId: 1, query: "hata" });
assert.equal(r3.isError, true);
assert.match(r3.content[0].text, /bilerek hata/);

const r4 = await cagir("upload_file", { tabId: 1, ref: "ref_1", paths: ["/yok/boyle/dosya.pdf"] });
assert.equal(r4.isError, true);
assert.match(r4.content[0].text, /Dosya yok/);

const r5 = await cagir("upload_file", { tabId: 1, ref: "ref_1", paths: [path.join(KOK, "README.md")] });
assert.ok(!r5.isError, r5.content[0].text);
assert.ok(r5.content[0].text.includes(path.join(KOK, "README.md")), "yol mutlak gitmedi");

// Eşzamanlı çağrılar karışmamalı.
const paralel = await Promise.all([1, 2, 3, 4, 5].map((n) => cagir("navigate", { tabId: n, url: `u${n}` })));
paralel.forEach((r, i) => assert.ok(r.content[0].text.includes(`"tabId":${i + 1}`)));

const bilinmez = await rpc("olmayan/yontem");
assert.equal(bilinmez.error.code, -32601);

// MCP süreci kapanınca kullandığı tüm oturumlar bitmeli.
mcp.stdin.end();
const biten = () => eklentiGelen.filter((m) => m.tur === "oturum_bitti").map((m) => m.oturum).sort();
for (let i = 0; i < 40 && biten().length < 2; i++) await bekle(50);
assert.deepEqual(biten(), [oturum, "ses_konusma1"].sort());

// Tarayıcı kapanınca (stdin kapanır) host soketi silip çıkmalı.
host.stdin.end();
await new Promise((r) => host.once("exit", r));
assert.ok(!fs.readdirSync(DIZIN).some((a) => a.endsWith(".sock")), "soket dosyası kaldı");

// Köprü yokken anlaşılır hata.
const mcp2 = spawn(process.execPath, [path.join(KOK, "mcp/server.mjs")], { env, stdio: ["pipe", "pipe", "inherit"] });
const yok = await new Promise((coz) => {
  mcp2.stdout.once("data", (d) => coz(JSON.parse(String(d))));
  mcp2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tabs_context", arguments: {} } }) + "\n");
});
assert.equal(yok.result.isError, true);
assert.match(yok.result.content[0].text, /köprüsü yok/);
mcp2.kill();

fs.rmSync(DIZIN, { recursive: true, force: true });
console.log("köprü testi: TAMAM");
