#!/usr/bin/env bash
# Génère de vraies fixtures média avec FFmpeg (§101).
#
# Aucune de ces fixtures n'est un mock : ce sont de vrais conteneurs, encodés
# avec de vrais codecs, que ffprobe analyse réellement. C'est la seule façon de
# vérifier que la couche d'analyse lit correctement une cadence 24000/1001, un
# timecode embarqué ou une piste 5.1.
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/fixtures/generated"
mkdir -p "$OUT"

if ! command -v ffmpeg > /dev/null; then
  echo "ffmpeg introuvable — fixtures non générées." >&2
  exit 1
fi

Q="-hide_banner -loglevel error -y"
SRC="testsrc2=size=320x240"
TONE="sine=frequency=440:sample_rate=48000"

echo "Génération dans $OUT"

# --- Cadences constantes, les cinq cas imposés par §100 -----------------------
ffmpeg $Q -f lavfi -i "${SRC}:rate=25:duration=2" -f lavfi -i "${TONE}:duration=2" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT/cfr_25.mp4"

ffmpeg $Q -f lavfi -i "${SRC}:rate=24000/1001:duration=2" \
  -c:v libx264 -pix_fmt yuv420p -r 24000/1001 "$OUT/cfr_23976.mp4"

ffmpeg $Q -f lavfi -i "${SRC}:rate=30000/1001:duration=2" \
  -c:v libx264 -pix_fmt yuv420p -r 30000/1001 -timecode "01:00:00;00" "$OUT/cfr_2997_df.mov"

ffmpeg $Q -f lavfi -i "${SRC}:rate=50:duration=2" \
  -c:v libx264 -pix_fmt yuv420p "$OUT/cfr_50.mp4"

ffmpeg $Q -f lavfi -i "${SRC}:rate=60000/1001:duration=2" \
  -c:v libx264 -pix_fmt yuv420p -r 60000/1001 "$OUT/cfr_5994.mp4"

# --- Timecode embarqué non nul (§9) ------------------------------------------
ffmpeg $Q -f lavfi -i "${SRC}:rate=25:duration=2" \
  -c:v libx264 -pix_fmt yuv420p -timecode "10:00:00:00" "$OUT/timecode_25.mov"

# --- Cadence variable (§13) ---------------------------------------------------
# Deux segments de cadences différentes concaténés dans un Matroska : les durées
# d'image varient réellement au sein du fichier.
ffmpeg $Q -f lavfi -i "${SRC}:rate=30:duration=1" -c:v libx264 -pix_fmt yuv420p "$OUT/_vfr_a.mkv"
ffmpeg $Q -f lavfi -i "${SRC}:rate=10:duration=1" -c:v libx264 -pix_fmt yuv420p "$OUT/_vfr_b.mkv"
printf "file '%s'\nfile '%s'\n" "$OUT/_vfr_a.mkv" "$OUT/_vfr_b.mkv" > "$OUT/_concat.txt"
ffmpeg $Q -f concat -safe 0 -i "$OUT/_concat.txt" -c copy -fflags +genpts "$OUT/vfr.mkv"
rm -f "$OUT/_vfr_a.mkv" "$OUT/_vfr_b.mkv" "$OUT/_concat.txt"

# --- Codecs de postproduction (§10) ------------------------------------------
ffmpeg $Q -f lavfi -i "${SRC}:rate=25:duration=1" \
  -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le "$OUT/prores_422hq.mov"

ffmpeg $Q -f lavfi -i "testsrc2=size=1280x720:rate=25:duration=1" \
  -c:v dnxhd -profile:v dnxhr_hq -pix_fmt yuv422p "$OUT/dnxhr_hq.mov"

# --- Couche alpha (§83) -------------------------------------------------------
ffmpeg $Q -f lavfi -i "${SRC}:rate=25:duration=1" \
  -vf "format=yuva444p10le,geq=a='255*(X/W)':r='r(X,Y)':g='g(X,Y)':b='b(X,Y)'" \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "$OUT/alpha_prores4444.mov"

# --- Audio (§31, §81) ---------------------------------------------------------
# `sine` produit du mono : on force deux canaux, comme le nom du fichier l'annonce.
ffmpeg $Q -f lavfi -i "${TONE}:duration=2" -ac 2 -c:a pcm_s16le "$OUT/audio_48k_stereo.wav"
ffmpeg $Q -f lavfi -i "${TONE}:duration=2" -ac 6 -c:a pcm_s24le "$OUT/audio_51.wav"
ffmpeg $Q -f lavfi -i "sine=frequency=440:sample_rate=96000:duration=1" -c:a pcm_s24le "$OUT/audio_96k.wav"

# Signal à enveloppe VARIABLE : quatre attaques suivies d'une décroissance.
# Un sinus d'amplitude constante remplit toute la hauteur et ne permet pas de
# vérifier qu'une forme d'onde suit réellement le signal.
ffmpeg $Q -f lavfi -i "aevalsrc='0.95*sin(2*PI*440*t)*exp(-4*mod(t,1))':d=4:s=48000" \
  -ac 2 -c:a pcm_s16le "$OUT/audio_enveloppe.wav"

# --- Séquence d'images (§84) --------------------------------------------------
mkdir -p "$OUT/sequence"
ffmpeg $Q -f lavfi -i "${SRC}:rate=25:duration=1" "$OUT/sequence/shot_%04d.png"

# --- Espace colorimétrique explicite (§29) ------------------------------------
ffmpeg $Q -f lavfi -i "${SRC}:rate=25:duration=1" \
  -c:v libx264 -pix_fmt yuv420p \
  -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc \
  "$OUT/hdr_pq.mp4"

# --- Fichier corrompu (§106) --------------------------------------------------
head -c 2048 "$OUT/cfr_25.mp4" > "$OUT/broken.mp4"

echo "Fixtures générées :"
ls -1 "$OUT"
