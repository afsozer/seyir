# Seyir

opencode'a kullanıcının kendi tarayıcısını (Brave, giriş yapılmış oturumlarıyla) kullandıran eklenti + MCP köprüsü. Claude in Chrome ve Codex Chrome eklentisinin opencode karşılığı. 30 Eyl 2026'da yazıldı. Yerel klasör `~/Developer/opencode-tarayici` (ad sonradan Seyir oldu; klasör, native host ve kasa yolları kırılmasın diye taşınmadı). Public vitrin: github.com/afsozer/seyir (lisans dosyası yok; README: kullanılabilir, kopyalama/değiştirme/dağıtma yasak).

## Kurulum (bir kez)

```bash
node ~/Developer/opencode-tarayici/bin/kur.mjs --opencode
```

- Native messaging host'u **kurulu** Chromium tarayıcılara tanıtır (şu an yalnız Brave). Manifest `com.sozer.opencode_tarayici.json`, iki yere yazılır: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` ve **`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`**.
- **Tuzak (30 Eyl 2026, Brave 1.96 ölçüldü):** Brave manifesti kendi klasöründen değil Chrome'unkinden okuyor. Yalnız kendi klasöründe dururken popup "Specified native messaging host not found" dedi. Chrome klasörüne konunca Brave host'u başlattı. Chrome kurulu olmasa da o klasör gerekli; Claude ve Codex de iki yere yazıyor.
- `host/host.sh`'yi `/opt/homebrew/bin/node` ile üretir (Cellar yolu değil; `brew upgrade node` kırmasın).
- `--opencode`: `~/.config/opencode/opencode.json`'a `mcp.tarayici` ekler, önce `opencode.json.bak-tarayici-<tarih>` yedeği alır. Tekrar çalıştırmak güvenli.
- Eklenti elle yüklenir: `brave://extensions` → Geliştirici modu → "Paketlenmemiş öğe yükle" → `~/Developer/opencode-tarayici/extension`. Eklenti kimliği sabit (manifest'teki `key`): `bgancoaoeokpmdckhbcocgbooiddbnac`.
- Kaldırma: `node bin/kur.mjs --kaldir`, eklentiyi Brave'den kaldır, `opencode.json`'dan `mcp.tarayici`'yi sil.

Kod değişince: eklenti tarafı → `brave://extensions`'ta yenile. MCP tarafı → OpenCode'u yeniden başlat (MCP süreçlerini masaüstü uygulamasının arka plan servisi açık tutar).

## Kullanım

opencode'da düz Türkçe: "tarayıcıda UYAP'ı aç, …". Ajan `tabs_context` ile başlar, `tabs_create` ile **konuşmaya özel sekme grubunu** açar ("opencode · <proje>", her konuşma ayrı renk). Konuşmalar birbirinin sekmesine dokunamaz; kullanıcının öteki sekmelerini göremez.

- **Açık bir sekmeyi vermek:** eklenti simgesi → "Bu sekmeyi opencode'a ver". Paylaşılan sekme her oturuma görünür, ajan onu kapatamaz.
- **Durdurmak:** simge → "Duraklat", ya da Brave'in sarı "hata ayıklama" şeridinde İptal. İkisi de bütün araçları durdurur, "Devam" diyene dek.
- **Rozet:** `!` köprü yok (host'un ilk "hazir" mesajı gelmeden yeşil olmaz) · `II` duraklatıldı · sayı = etkin sekme grubu.

Araçlar (19): tabs_context, tabs_create, tabs_close, navigate (url/back/forward/reload), read_page (erişilebilirlik ağacı + ref), find, get_page_text, click, hover, type, press_key, form_input, scroll, screenshot, javascript, console_messages, network_requests (+ yanıt gövdesi), wait_for, upload_file.

## Mimari

```
opencode servisi ─MCP stdio─> mcp/server.mjs ─Unix soketi─> host/host.mjs ─native messaging─> extension/background.js ─CDP / chrome.*─> sekmeler
```

| Dosya | Görev |
|---|---|
| `mcp/server.mjs` | Bağımlılıksız MCP sunucusu. Araç şemaları burada. Çağrıyı sokete iletir; ekran görüntüsünü `$TMPDIR/opencode-tarayici-ekran/`'a da yazar (son 30). |
| `host/host.mjs` | Brave'in başlattığı köprü. stdio'da 4 bayt uzunluk + JSON; `/tmp/opencode-tarayici-sozer/<pid>.sock` (dizin 0700). Log: `logs/host.log`. |
| `extension/background.js` | Oturumlar, sekme grupları, yetki, CDP (`chrome.debugger`), araçlar. |
| `extension/sayfa.js` | Sayfaya enjekte edilen tek fonksiyon: ağaç, ref'ler, form doldurma. Kendi kendine yeter (`executeScript` kaynağı kopyalar). |
| `extension/popup.*` | Durum, oturumlar, sekme paylaşma, duraklatma. |

Tek sefer bakılan sistem: Claude in Chrome (`claude --chrome-native-host` → `/tmp/claude-mcp-browser-bridge-sozer/<pid>.sock`) ve Codex (`ChatGPT for Chrome` binary'si → `/tmp/codex-browser-use/<uuid>.sock`) aynı düzeni kullanıyor. Codex farklı olarak modele tek bir `js` aracı verip kod yazdırıyor; burada, zayıf/ucuz modellerde daha sağlam diye Claude'un sabit araç listesi tercih edildi.

## Kararlar

- **Native messaging + Unix soketi, WebSocket değil.** Açık port yok. Host'u yalnız izinli eklenti başlatabilir. Birden çok opencode süreci aynı host'a bağlanır, sabit port çakışması yaşanmaz.
- **Konuşma başına grup.** opencode v2 bir projedeki bütün konuşmalar için tek MCP süreci açar ama her `tools/call`'da `_meta["ai.opencode/sessionID"]` gönderir. Oturum anahtarı budur; yoksa süreç UUID'si kullanılır. Etiket = MCP'nin çalışma dizininin adı (proje).
- **Yetki sınırı grup üyeliğidir.** Kullanıcı bir sekmeyi elle gruba sürüklerse ajan onu da kullanabilir.
- **Diyaloglar:** alert kabul edilir; confirm/prompt/beforeunload varsayılan olarak iptal edilir. `accept_dialog: true` (click/type/press_key/navigate) sonraki 15 sn için kabul ettirir. Sonuç metnine not düşülür.
- **Geri/ileri CDP ile.** `chrome.tabs.goBack` Chrome'un geçmiş müdahalesi yüzünden etkileşimsiz girdileri atlıyor ("Cannot find a next page in history"). `Page.navigateToHistoryEntry` bu kurala takılmıyor.
- **Ekran görüntüsü CSS pikseline ölçeklenir** (en çok 1280 px), JPEG 0.8. Tıklamadaki x,y görüntü pikselidir, ölçek sekmeye göre geri çevrilir. opencode MCP görsellerini modele "media" olarak iletiyor (2.0.16 binary'sinden doğrulandı).
- **Debugger 5 dk boşta kalan sekmeden ayrılır.** Konsol ve ağ kaydı ilk bağlanmadan itibaren tutulur.
- **Ağaç sezgileri:** `cursor:pointer`/`tabindex`/`onclick` ile "clickable" sayılan rolsüz öğe, içinde gerçek hedef (link/düğme/alan) varsa kapsayıcı sayılır. 100 karakterden uzun kart metnini yutmaz. Adsız list/listitem/region satırı yazılmaz. Ad bulmada boşluk "dolu" sayılmaz; yalnız resimli linklerde `title` ya da içteki `img alt` kullanılır.

## Sınırlar

- iframe içi okunmaz (satırda `(içi okunmadı)`); kapalı shadow DOM okunmaz; `upload_file` shadow DOM içindeki dosya alanını bulamaz.
- `chrome://`, `brave://`, eklenti mağazası ve başka eklenti sayfaları kontrol edilemez.
- Ajan çalışırken Brave'in üstünde "hata ayıklama başladı" şeridi görünür (Claude'da da aynı).
- `type` metni `Input.insertText` ile yazar: tuş olayı üretmez, `input` olayı üretir. Tuşa bağlı sitelerde `press_key` kullanılır.

## Testler

```bash
node test/kopru-testi.mjs      # tarayıcısız: host + MCP, sahte eklenti
node test/uctan-uca.mjs        # gerçek eklenti, geçici profilli Chrome for Testing (Playwright önbelleği), yerel test sayfası
node test/opencode-ile.mjs     # gerçek opencode + model (birkaç kuruş): form doldur, onay kodunu oku
node test/canli-sayfa.mjs <url> [interactive|all]   # gerçek sitede ağaç kalitesi ve hız
```

Uçtan uca testler kullanıcının Brave'ine ve kurulumuna dokunmaz; host'u `OCT_SOKET_DIZINI` ile ayrı sokete bağlar. `OCT_DEBUG=1` gelen MCP çağrılarının `_meta`'sını `logs/mcp-debug.log`'a yazar.

30 Eyl 2026 durumu: üç test de geçti. mevzuat.gov.tr, tr.wikipedia (Denizli) ve GitHub'da ağaç 6–53 ms'de çıkıyor.

Canlı duman testi (30 Eyl gece, gerçek opencode oturumu): `tabs_create` ile example.com açıldı (konuşma grubu 'blue'); `read_page`, `screenshot` ve `javascript` (`navigator.brave` = true, tr-TR, dpr 2) çalıştı. Sekme paylaşma yolu bu testte denenmedi.

## Esinlenilen

- [G10hdz/Opencode-chrome](https://github.com/G10hdz/Opencode-chrome) (MIT): CDP, ref doğrulama, sahte eklentiyle köprü testi fikri.
- [benjaminshafii/opencode-browser](https://github.com/benjaminshafii/opencode-browser) (lisanssız, kod alınmadı): native messaging + Unix soketi düzeni.
- Anthropic ve OpenAI eklentileri (tescilli): yalnız mimari incelendi, kod alınmadı.
