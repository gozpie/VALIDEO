#!/usr/bin/env bash
# Vérifie la présence et la version des outils requis pour développer AI Scene Studio.
set -uo pipefail

status=0
check() { # nom, commande de version, motif attendu, obligatoire(1)/optionnel(0)
  local name=$1 cmd=$2 expected=$3 required=$4 version
  if ! version=$(eval "$cmd" 2>/dev/null | head -n1); then version=""; fi
  if [[ -z $version ]]; then
    if [[ $required == 1 ]]; then echo "✗ $name : absent (requis $expected)"; status=1
    else echo "– $name : absent (optionnel, requis à partir d'une phase ultérieure)"; fi
  elif [[ $version =~ $expected ]]; then echo "✓ $name : $version"
  else echo "✗ $name : $version (attendu $expected)"; [[ $required == 1 ]] && status=1; fi
}

check "Node.js" "node --version" "^v22\." 1
check "pnpm" "pnpm --version" "^10\." 1
check "Python" "python3 --version" "3\.13\." 1
check "uv" "uv --version" "^uv 0\.11\." 1
check "Docker" "docker --version" "Docker version" 1
check "Docker Compose" "docker compose version" "v(2|5)\." 1
check "FFmpeg" "ffmpeg -version" "ffmpeg version" 0
check "Blender" "blender --version" "Blender [0-9]+\." 0

exit $status
