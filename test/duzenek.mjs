// Test düzeneği: eklentiyi Chrome for Testing'e (Playwright önbelleği) geçici
// profille yükler, host'u tarayıcıya native messaging ile başlattırır ve MCP
// sunucusunu opencode gibi sürer. Kullanıcının tarayıcısına/kurulumuna dokunmaz.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const KOK = path.resolve(new URL("..", import.meta.url).pathname);
export const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeBul() {
  if (process.env.OCT_CHROME) return process.env.OCT_CHROME;
  const pw = path.join(os.homedir(), "Library/Caches/ms-playwright");
  for (const d of fs.readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const b = path.join(pw, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(b)) return b;
  }
  throw new Error("Chrome for Testing yok: npx playwright install chromium");
}

export async function duzenekKur({ etiket = "test" } = {}) {
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), "oct-e2e-"));
  const profil = path.join(gecici, "profil");
  const soketler = path.join(gecici, "soket");
  const sarmal = path.join(gecici, "host.sh");
  fs.writeFileSync(sarmal, `#!/bin/sh\nexec "${process.execPath}" "${path.join(KOK, "host/host.mjs")}" "$@"\n`, { mode: 0o755 });
  const { key } = JSON.parse(fs.readFileSync(path.join(KOK, "extension/manifest.json")));
  const kimlik = [...createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)]
    .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
    .join("");
  fs.mkdirSync(path.join(profil, "NativeMessagingHosts"), { recursive: true });
  fs.writeFileSync(
    path.join(profil, "NativeMessagingHosts/com.sozer.opencode_tarayici.json"),
    JSON.stringify({ name: "com.sozer.opencode_tarayici", description: "test", path: sarmal, type: "stdio", allowed_origins: [`chrome-extension://${kimlik}/`] })
  );

  const env = { ...process.env, OCT_SOKET_DIZINI: soketler, OCT_ETIKET: etiket };
  const chrome = spawn(
    chromeBul(),
    [
      ...(process.env.OCT_GORUNUR ? [] : ["--headless=new"]),
      `--user-data-dir=${profil}`,
      `--load-extension=${path.join(KOK, "extension")}`,
      `--disable-extensions-except=${path.join(KOK, "extension")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      "about:blank",
    ],
    { env, stdio: ["ignore", "ignore", "pipe"] }
  );
  let chromeHata = "";
  chrome.stderr.on("data", (d) => (chromeHata += d));
  const hazir = () => fs.existsSync(soketler) && fs.readdirSync(soketler).some((a) => a.endsWith(".sock"));
  for (let i = 0; i < 100 && !hazir(); i++) await bekle(100);
  if (!hazir()) {
    chrome.kill();
    throw new Error("Eklenti host'u başlatmadı.\n" + chromeHata.slice(-2000));
  }

  const mcp = spawn(process.execPath, [path.join(KOK, "mcp/server.mjs")], { env, stdio: ["pipe", "pipe", "inherit"] });
  const yanit = new Map();
  let g = "";
  mcp.stdout.setEncoding("utf8");
  mcp.stdout.on("data", (p) => {
    g += p;
    let i;
    while ((i = g.indexOf("\n")) >= 0) {
      const m = JSON.parse(g.slice(0, i));
      g = g.slice(i + 1);
      yanit.get(m.id)?.(m);
    }
  });
  let sira = 0;
  const rpc = (method, params) =>
    new Promise((coz) => {
      const id = ++sira;
      yanit.set(id, coz);
      mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });

  async function arac(name, args = {}, hataBekle = false, _meta) {
    const r = (await rpc("tools/call", { name, arguments: args, _meta })).result;
    const metin = r.content[0].text;
    if (!hataBekle && r.isError) throw new Error(`${name} hata verdi: ${metin}`);
    return { metin, r };
  }
  function kapat() {
    try {
      mcp.kill();
    } catch {}
    chrome.kill();
    setTimeout(() => fs.rmSync(gecici, { recursive: true, force: true }), 500);
  }
  return { arac, rpc, kapat, soketler };
}
