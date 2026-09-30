#!/usr/bin/env node
// Kurulum: native messaging host'unu tarayıcılara tanıtır, host.sh'yi üretir,
// istenirse opencode.json'a MCP kaydını ekler. Tekrar çalıştırmak güvenli.
//
//   node bin/kur.mjs              # host'u kur (Brave, Chrome, Chromium, Edge, Vivaldi — hangisi varsa)
//   node bin/kur.mjs --opencode   # + ~/.config/opencode/opencode.json'a "tarayici" MCP'sini ekle
//   node bin/kur.mjs --kaldir     # host manifestlerini kaldır
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KOK = path.resolve(new URL("..", import.meta.url).pathname);
const HOST_ADI = "com.sozer.opencode_tarayici";
const DESTEK = path.join(os.homedir(), "Library/Application Support");
// ad → [Application Support alt dizini, uygulama paketi]. Yalnız uygulaması
// kurulu olanlara yazılır (eski kurulumdan kalan boş klasörlere değil).
const TARAYICILAR = {
  Brave: ["BraveSoftware/Brave-Browser", "Brave Browser.app"],
  Chrome: ["Google/Chrome", "Google Chrome.app"],
  "Chrome Beta": ["Google/Chrome Beta", "Google Chrome Beta.app"],
  Chromium: ["Chromium", "Chromium.app"],
  Edge: ["Microsoft Edge", "Microsoft Edge.app"],
  Vivaldi: ["Vivaldi", "Vivaldi.app"],
};
const kurulu = (app) => ["/Applications", path.join(os.homedir(), "Applications")].some((d) => fs.existsSync(path.join(d, app)));
// Homebrew'un sabit bağlantısını tercih et; process.execPath sürümlü Cellar
// yoluna çözülür ve "brew upgrade node" sonrası kırılır.
const NODE = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].find((y) => fs.existsSync(y)) || process.execPath;
const argv = new Set(process.argv.slice(2));

function eklentiKimligi() {
  const { key } = JSON.parse(fs.readFileSync(path.join(KOK, "extension/manifest.json"), "utf8"));
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
}

const KIMLIK = eklentiKimligi();
const HOST_SH = path.join(KOK, "host/host.sh");

if (argv.has("--kaldir")) {
  for (const [ad, [alt]] of Object.entries(TARAYICILAR)) {
    const f = path.join(DESTEK, alt, "NativeMessagingHosts", HOST_ADI + ".json");
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      console.log(`kaldırıldı: ${ad}`);
    }
  }
  process.exit(0);
}

// Tarayıcı host'u kısıtlı bir PATH ile başlatır; node'u mutlak yolla çağır.
fs.writeFileSync(
  HOST_SH,
  `#!/bin/sh\n# bin/kur.mjs üretti; elle düzenleme.\nexec "${NODE}" "${path.join(KOK, "host/host.mjs")}" "$@"\n`
);
fs.chmodSync(HOST_SH, 0o755);
fs.mkdirSync(path.join(KOK, "logs"), { recursive: true });

const manifest = {
  name: HOST_ADI,
  description: "Seyir köprüsü (opencode)",
  path: HOST_SH,
  type: "stdio",
  allowed_origins: [`chrome-extension://${KIMLIK}/`],
};

let kurulan = 0;
for (const [ad, [alt, app]] of Object.entries(TARAYICILAR)) {
  const kok = path.join(DESTEK, alt);
  const f = path.join(kok, "NativeMessagingHosts", HOST_ADI + ".json");
  if (!kurulu(app) || !fs.existsSync(kok)) {
    // Tarayıcı kaldırılmışsa eski kaydı temizle; Chrome klasörü Brave için aşağıda yazılır.
    if (fs.existsSync(f) && !(ad === "Chrome" && kurulu(TARAYICILAR.Brave[1]))) fs.rmSync(f);
    continue;
  }
  const dizin = path.join(kok, "NativeMessagingHosts");
  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, HOST_ADI + ".json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`host kuruldu: ${ad}`);
  kurulan++;
}
// Brave (macOS) native host manifestini kendi klasöründen DEĞİL, Chrome'unkinden
// okuyor: kendi klasöründe "Specified native messaging host not found" verdi,
// Google/Chrome/NativeMessagingHosts'a konunca başlattı (30 Eyl 2026, Brave 1.96,
// ölçüldü). Claude ve Codex de iki klasöre birden yazıyor. Chrome kurulu olmasa da yaz.
if (kurulu(TARAYICILAR.Brave[1])) {
  const dizin = path.join(DESTEK, TARAYICILAR.Chrome[0], "NativeMessagingHosts");
  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, HOST_ADI + ".json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("host kuruldu: Brave (Chrome klasörü üzerinden)");
}
if (!kurulan) console.log("Desteklenen tarayıcı bulunamadı.");

if (argv.has("--opencode")) {
  const yol = path.join(os.homedir(), ".config/opencode/opencode.json");
  const cfg = JSON.parse(fs.readFileSync(yol, "utf8"));
  const kayit = { type: "local", command: [NODE, path.join(KOK, "mcp/server.mjs")], enabled: true };
  if (JSON.stringify(cfg.mcp?.tarayici) === JSON.stringify(kayit)) console.log("opencode.json zaten güncel.");
  else {
    const z = new Date();
    const iki = (n) => String(n).padStart(2, "0");
    const damga = `${z.getFullYear()}${iki(z.getMonth() + 1)}${iki(z.getDate())}-${iki(z.getHours())}${iki(z.getMinutes())}${iki(z.getSeconds())}`;
    fs.copyFileSync(yol, `${yol}.bak-tarayici-${damga}`);
    cfg.mcp = { ...(cfg.mcp || {}), tarayici: kayit };
    fs.writeFileSync(yol, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`opencode.json'a "tarayici" MCP'si eklendi (yedek: opencode.json.bak-tarayici-${damga}).`);
  }
}

console.log(`
Eklenti kimliği: ${KIMLIK}
Eklentiyi yüklemek için (bir kez):
  1. Tarayıcıda brave://extensions (ya da chrome://extensions) aç
  2. Sağ üstten "Geliştirici modu"nu aç
  3. "Paketlenmemiş öğe yükle" → ${path.join(KOK, "extension")}
Simgedeki rozet "!" değilse köprü bağlıdır.`);
