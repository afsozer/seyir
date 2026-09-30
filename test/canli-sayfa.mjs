// Gerçek bir sayfayı eklentiyle açıp read_page çıktısını gösterir; ağaç
// kalitesini ve hızını gözle denetlemek için (geçici profil, oturum yok).
//   node test/canli-sayfa.mjs <url> [interactive|all] [satır sayısı]
import { duzenekKur } from "./duzenek.mjs";

const [url, filtre = "interactive", satir = "60"] = process.argv.slice(2);
if (!url) {
  console.error("kullanım: node test/canli-sayfa.mjs <url> [interactive|all] [satır]");
  process.exit(2);
}
const { arac, kapat } = await duzenekKur({ etiket: "canli" });
try {
  const { metin: acilis } = await arac("tabs_create", { url });
  const tabId = Number(acilis.match(/tabId (\d+)/)[1]);
  const t0 = Date.now();
  const { metin } = await arac("read_page", { tabId, filter: filtre });
  const sure = Date.now() - t0;
  const satirlar = metin.split("\n");
  console.log(satirlar.slice(0, Number(satir)).join("\n"));
  console.log(`\n… toplam ${satirlar.length} satır, ${metin.length} karakter, ${sure} ms`);
} catch (e) {
  console.error("HATA:", e.message);
} finally {
  kapat();
  setTimeout(() => process.exit(0), 700);
}
