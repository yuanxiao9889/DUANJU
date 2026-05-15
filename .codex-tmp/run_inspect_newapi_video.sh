#!/usr/bin/env bash
set -euo pipefail
cd /www/dk_project/dk_app/newapi/newapi_isGp
docker exec -i newapi_isgp-mysql-1 sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -D new-api -N' < /tmp/inspect_newapi_video.sql
