#!/bin/sh
set -e

cat > /usr/share/nginx/html/app/config.js <<EOF
window.__APP_CONFIG__ = {
  WAMP_URL: "${WAMP_URL:-ws://localhost:8080/ws}",
  WAMP_REALM: "${WAMP_REALM:-io.xconn.deskconn}",
  REGISTRATION_AUTHID: "${REGISTRATION_AUTHID:-deskconn-web-app}"
};
EOF

exec "$@"
