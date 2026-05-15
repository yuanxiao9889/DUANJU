#!/usr/bin/env bash
set -euo pipefail

cd /www/dk_project/dk_app/newapi/newapi_isGp
TOKEN="$(
  docker exec newapi_isgp-mysql-1 sh -lc \
    'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -D new-api -N -e "SELECT \`key\` FROM tokens WHERE status=1 LIMIT 1"' \
    | tr -d '\r' \
    | head -1
)"

if [[ -z "$TOKEN" ]]; then
  echo "NO_TOKEN"
  exit 1
fi

printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' | base64 -d > /tmp/oopii-ref-test.png
RESP="$(
  curl -sS -w $'\nHTTP_STATUS:%{http_code}' \
    -H "Authorization: Bearer sk-${TOKEN}" \
    -F "file=@/tmp/oopii-ref-test.png;type=image/png" \
    https://www.oopii.cn/api/v1/video-reference-images
)"

echo "$RESP"
URL="$(echo "$RESP" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p' | head -1)"
if [[ -n "$URL" ]]; then
  curl -sS -I "$URL" | sed -n '1,8p'
fi
