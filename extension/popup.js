const RENK = {
  orange: "#f97316", blue: "#3b82f6", green: "#22c55e", purple: "#a855f7", cyan: "#06b6d4",
  pink: "#ec4899", yellow: "#eab308", red: "#ef4444", grey: "#9ca3af",
};
const $ = (id) => document.getElementById(id);
let sekme;

async function yenile(mesaj = { tur: "durum" }) {
  const d = await chrome.runtime.sendMessage(mesaj);
  $("nokta").className = "nokta " + (d.bagli ? "acik" : "kapali");
  $("kopru").innerHTML = d.bagli
    ? "Köprü bağlı. opencode'dan kullanılabilir."
    : `Köprü bağlı değil.<div class="kucuk" id="hata"></div>
       <div class="kucuk">Kurulum: <code>node ~/Developer/opencode-tarayici/bin/kur.mjs</code></div>
       <button id="baglan">Yeniden bağlan</button>`;
  if ($("hata")) $("hata").textContent = d.hostHatasi || "";
  $("baglan")?.addEventListener("click", () => yenile({ tur: "yeniden_baglan" }));

  const ul = $("oturumlar");
  ul.replaceChildren();
  if (!d.oturumlar.length) ul.innerHTML = '<li class="kucuk">Açık opencode oturumu yok.</li>';
  for (const o of d.oturumlar) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="renk" style="background:${RENK[o.renk] || "#999"}"></span><span></span><span class="kucuk"></span>`;
    li.children[1].textContent = o.ad;
    li.children[2].textContent = `${o.sekme} sekme`;
    ul.append(li);
  }

  const paylasildi = sekme && d.paylasilan.includes(sekme.id);
  $("sekme-bilgi").textContent = sekme ? sekme.title : "";
  $("paylas").textContent = paylasildi ? "Paylaşımı kaldır" : "Bu sekmeyi opencode'a ver";
  $("paylas").className = paylasildi ? "" : "ana";
  $("paylas").disabled = !sekme || !/^https?:|^file:/.test(sekme.url || "");
  $("duraklat").textContent = d.duraklatildi ? "▶ Devam ettir" : "❚❚ Duraklat (ajanı durdur)";
  $("duraklat").onclick = () => yenile({ tur: "duraklat", deger: !d.duraklatildi });
}

(async () => {
  [sekme] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("paylas").onclick = () => yenile({ tur: "paylas", tabId: sekme.id });
  yenile();
})();
