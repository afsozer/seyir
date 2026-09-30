// Native messaging köprüsü. Tarayıcı bu süreci eklenti bağlanınca kendisi
// başlatır (stdio; her mesaj 4 bayt uzunluk + UTF-8 JSON). Biz de bir Unix
// soketi açarız; her opencode MCP süreci (mcp/server.mjs) buna bağlanır ve
// satır satır JSON konuşur. Soket dizini 0700: yalnız bu kullanıcı erişir.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const DIZIN = process.env.OCT_SOKET_DIZINI || `/tmp/opencode-tarayici-${os.userInfo().username}`;
const SOKET = path.join(DIZIN, `${process.pid}.sock`);
const LOG = new URL("../logs/host.log", import.meta.url).pathname;
const TARAYICIYA_AZAMI = 1024 * 1024; // host → tarayıcı mesaj sınırı (Chrome)

function log(...a) {
  try {
    if (fs.statSync(LOG, { throwIfNoEntry: false })?.size > 1_000_000) fs.truncateSync(LOG, 0);
    fs.appendFileSync(LOG, `${new Date().toISOString()} [${process.pid}] ${a.join(" ")}\n`);
  } catch {}
}

// ------------------------------------------------------------ tarayıcı tarafı (stdio)

function tarayiciya(m) {
  const govde = Buffer.from(JSON.stringify(m));
  if (govde.length > TARAYICIYA_AZAMI) throw new Error("Mesaj tarayıcı sınırını (1 MB) aşıyor.");
  const bas = Buffer.alloc(4);
  bas.writeUInt32LE(govde.length);
  process.stdout.write(Buffer.concat([bas, govde]));
}

let tampon = Buffer.alloc(0);
process.stdin.on("data", (parca) => {
  tampon = Buffer.concat([tampon, parca]);
  while (tampon.length >= 4) {
    const n = tampon.readUInt32LE(0);
    if (tampon.length < 4 + n) break;
    const govde = tampon.subarray(4, 4 + n);
    tampon = tampon.subarray(4 + n);
    try {
      tarayicidan(JSON.parse(govde.toString("utf8")));
    } catch (e) {
      log("bozuk mesaj:", e.message);
    }
  }
});
process.stdin.on("end", () => kapat("tarayıcı bağlantıyı kapattı"));
process.stdout.on("error", () => kapat("stdout kapandı"));

// ------------------------------------------------------------ istemciler (Unix soketi)

const istemciler = new Map(); // no → { soket, etiket, oturumlar: Set }
const bekleyen = new Map(); // genelId → { no, id }
let istemciSira = 0;
let istekSira = 0;

function istemciye(no, m) {
  const i = istemciler.get(no);
  if (i && !i.soket.destroyed) i.soket.write(JSON.stringify(m) + "\n");
}

function canliListesi() {
  tarayiciya({ tur: "canli", oturumlar: [...new Set([...istemciler.values()].flatMap((i) => [...i.oturumlar]))] });
}

function tarayicidan(m) {
  if (m.tur === "yanit" || m.tur === "hata") {
    const b = bekleyen.get(m.id);
    if (!b) return;
    bekleyen.delete(m.id);
    istemciye(b.no, { ...m, id: b.id });
  } else if (m.tur === "merhaba") log("eklenti bağlandı, sürüm", m.surum);
}

function istemcidenSatir(no, satir) {
  let m;
  try {
    m = JSON.parse(satir);
  } catch {
    return;
  }
  const i = istemciler.get(no);
  if (m.tur === "merhaba") {
    i.varsayilan = String(m.oturum || "");
    i.etiket = String(m.etiket || "").slice(0, 40);
    istemciye(no, { tur: "merhaba", pid: process.pid });
    return;
  }
  if (m.tur === "istek") {
    const oturum = String(m.oturum || i.varsayilan || "");
    if (!oturum) return istemciye(no, { tur: "hata", id: m.id, mesaj: "Oturum yok: önce merhaba gönderilmeli." });
    i.oturumlar.add(oturum);
    const gid = `${no}:${++istekSira}`;
    bekleyen.set(gid, { no, id: m.id });
    try {
      tarayiciya({ tur: "istek", id: gid, oturum, etiket: i.etiket, arac: m.arac, args: m.args || {} });
    } catch (e) {
      bekleyen.delete(gid);
      istemciye(no, { tur: "hata", id: m.id, mesaj: e.message });
    }
  }
}

function eskiSoketleriTemizle() {
  for (const ad of fs.readdirSync(DIZIN)) {
    const pid = Number(ad.replace(/\.sock$/, ""));
    if (!ad.endsWith(".sock") || !pid || pid === process.pid) continue;
    try {
      process.kill(pid, 0);
    } catch {
      fs.rmSync(path.join(DIZIN, ad), { force: true });
    }
  }
}

fs.mkdirSync(DIZIN, { recursive: true, mode: 0o700 });
fs.chmodSync(DIZIN, 0o700);
eskiSoketleriTemizle();

const sunucu = net.createServer((soket) => {
  const no = ++istemciSira;
  istemciler.set(no, { soket, varsayilan: "", etiket: "", oturumlar: new Set() });
  let kalan = "";
  soket.setEncoding("utf8");
  soket.on("data", (parca) => {
    kalan += parca;
    let i;
    while ((i = kalan.indexOf("\n")) >= 0) {
      const satir = kalan.slice(0, i);
      kalan = kalan.slice(i + 1);
      if (satir.trim()) istemcidenSatir(no, satir);
    }
  });
  soket.on("error", () => {});
  soket.on("close", () => {
    const i = istemciler.get(no);
    istemciler.delete(no);
    for (const [gid, b] of bekleyen) if (b.no === no) bekleyen.delete(gid);
    // Aynı oturumu kullanan başka (yeniden bağlanmış) istemci yoksa oturum bitti.
    for (const o of i?.oturumlar || []) {
      if ([...istemciler.values()].some((x) => x.oturumlar.has(o))) continue;
      try {
        tarayiciya({ tur: "oturum_bitti", oturum: o });
      } catch {}
    }
    log("istemci ayrıldı", no);
  });
  log("istemci bağlandı", no);
});
sunucu.listen(SOKET, () => {
  fs.chmodSync(SOKET, 0o600);
  log("dinliyor", SOKET);
  // Eklenti "bağlı" demek için bu ilk mesajı bekler (host bulunamazsa hiç gelmez).
  tarayiciya({ tur: "hazir", pid: process.pid });
});
// MCP süreçleri eski host'tan bu yenisine geçsin diye biraz bekle, sonra
// geri gelmeyen oturumları eklentiye bildir.
setTimeout(() => {
  try {
    canliListesi();
  } catch {}
}, 10000);

function kapat(neden) {
  log("kapanıyor:", neden);
  try {
    fs.rmSync(SOKET, { force: true });
  } catch {}
  process.exit(0);
}
process.on("SIGTERM", () => kapat("SIGTERM"));
process.on("SIGINT", () => kapat("SIGINT"));
