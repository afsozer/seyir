# Seyir

**opencode ajanına kendi tarayıcını kullandıran eklenti + MCP köprüsü.**
Claude in Chrome ve Codex Chrome eklentisinin [opencode](https://opencode.ai) karşılığı. Ajan, giriş yapılmış oturumlarınla gerçek tarayıcında kendi sekme grubunu açar; orada gezinir, sayfayı okur, tıklar, yazar, form doldurur, ekran görüntüsü alır.

*A browser extension + MCP bridge that lets opencode agents drive your real Chromium browser (Brave/Chrome) with your logged-in sessions, inside their own tab group — the opencode counterpart of Claude in Chrome.*

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23603231.svg)](https://doi.org/10.5281/zenodo.23603231)

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

Licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`); the full text is in [LICENSE](LICENSE). If you modify the software and offer it to others over a network, you must make your modified source code available to those users under the same licence.

GNU Affero Genel Kamu Lisansı sürüm 3 ile lisanslanmıştır (`AGPL-3.0-only`); tam metin [LICENSE](LICENSE) dosyasındadır. Yazılımı değiştirip ağ üzerinden başkalarına hizmet olarak sunarsanız, değiştirdiğiniz kaynak kodu da o kullanıcılara aynı lisansla sunmanız gerekir.
