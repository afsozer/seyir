# Seyir

**opencode ajanına kendi tarayıcını kullandıran eklenti + MCP köprüsü.**
Claude in Chrome ve Codex Chrome eklentisinin [opencode](https://opencode.ai) karşılığı. Ajan, giriş yapılmış oturumlarınla gerçek tarayıcında kendi sekme grubunu açar; orada gezinir, sayfayı okur, tıklar, yazar, form doldurur, ekran görüntüsü alır.

*A browser extension + MCP bridge that lets opencode agents drive your real Chromium browser (Brave/Chrome) with your logged-in sessions, inside their own tab group — the opencode counterpart of Claude in Chrome.*

## Nasıl çalışır

```
opencode ─MCP stdio─> mcp/server.mjs ─Unix soketi─> host/host.mjs ─native messaging─> eklenti ─CDP─> sekmeler
```

- **Konuşma başına sekme grubu.** Her opencode konuşması "opencode · proje" adlı, kendi renginde bir grup açar. Konuşmalar birbirinin sekmesine dokunamaz. Ajan kullanıcının öteki sekmelerini görmez; yalnız kullanıcının eklenti simgesinden paylaştığı sekmeyi kullanabilir.
- **Açık port yok.** Köprüyü tarayıcı, native messaging ile yalnız bu eklenti için başlatır. MCP süreçleri ona kullanıcıya özel bir Unix soketiyle (0700) bağlanır.
- **Bağımlılık yok.** Eklenti, köprü ve MCP sunucusu düz JavaScript; `npm install` gerekmez.
- **Kullanıcı denetimde.** Eklenti simgesinden "Duraklat", ya da tarayıcının "hata ayıklama" şeridinde İptal, ajanı anında durdurur. Onay/iptal diyalogları varsayılan olarak iptal edilir.

## Araçlar

`tabs_context` · `tabs_create` · `tabs_close` · `navigate` · `read_page` (erişilebilirlik ağacı, `ref_N` referanslı) · `find` · `get_page_text` · `click` · `hover` · `type` · `press_key` · `form_input` · `scroll` · `screenshot` · `javascript` · `console_messages` · `network_requests` · `wait_for` · `upload_file`

## Kurulum (macOS)

```bash
node bin/kur.mjs --opencode   # native host kaydı + opencode.json'a MCP ekler (yedek alarak)
```

Ardından tarayıcıda `brave://extensions` (ya da `chrome://extensions`) → Geliştirici modu → "Paketlenmemiş öğe yükle" → `extension/`. Simgedeki rozet `!` değilse köprü bağlıdır.

## Testler

```bash
node test/kopru-testi.mjs   # tarayıcısız: köprü + MCP, sahte eklenti
node test/uctan-uca.mjs     # gerçek eklenti, geçici profilli Chrome for Testing
node test/opencode-ile.mjs  # gerçek opencode + model ile form doldurma
```

Mimari, kararlar ve bilinen sınırlar: [docs/seyir.md](docs/seyir.md).

## License

© 2026 Alpaslan Fatih Sözer. All rights reserved. The source code is published for review only; it may not be used, copied, modified or distributed without written permission.

Tüm hakları saklıdır. Kaynak kod yalnızca inceleme amacıyla yayımlanmıştır; yazılı izin olmadan kullanılamaz, kopyalanamaz, değiştirilemez veya dağıtılamaz.
