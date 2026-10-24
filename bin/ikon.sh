#!/bin/zsh
# extension/ikon/*.svg -> 16/32/48/128 PNG. Headless Brave/Chrome ile çizer.
# 16 ve 32 px için sadeleştirilmiş ikon-kucuk.svg, 48 ve 128 için ikon.svg.
set -euo pipefail
kok=${0:A:h:h}/extension/ikon
tarayici=${TARAYICI:-}
if [[ -z $tarayici ]]; then
  for t in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    [[ -x $t ]] && { tarayici=$t; break; }
  done
fi
[[ -n $tarayici ]] || { echo "Chromium tabanlı tarayıcı bulunamadı (TARAYICI=... ile ver)" >&2; exit 1; }
gecici=$(mktemp -d); trap 'rm -rf $gecici' EXIT
for boyut kaynak in 16 ikon-kucuk 32 ikon-kucuk 48 ikon 128 ikon; do
  print -r -- "<!doctype html><style>html,body{margin:0;height:100%;background:transparent}body{display:grid;place-items:center}img{display:block}</style><img src=\"file://$kok/$kaynak.svg\" width=$boyut height=$boyut>" > $gecici/s.html
  "$tarayici" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size=512,512 \
    --screenshot=$gecici/tam.png file://$gecici/s.html 2>/dev/null
  # sips ortadan kırpar; ikon da sayfanın ortasında
  sips -c $boyut $boyut $gecici/tam.png --out $kok/$boyut.png >/dev/null
  echo "$kok/$boyut.png"
done
