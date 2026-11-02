#!/bin/sh
# Génère la configuration d'identité S3 à partir des variables d'environnement
# (aucun secret n'est versionné), puis démarre SeaweedFS en mode tout-en-un avec la passerelle S3.
set -eu
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID requis}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY requis}"
sed -e "s|\${S3_ACCESS_KEY_ID}|${S3_ACCESS_KEY_ID}|" \
    -e "s|\${S3_SECRET_ACCESS_KEY}|${S3_SECRET_ACCESS_KEY}|" \
    /etc/seaweedfs/s3.json.template > /tmp/s3.json
exec weed server -dir=/data -ip.bind=0.0.0.0 -s3 -s3.port=8333 -s3.config=/tmp/s3.json
