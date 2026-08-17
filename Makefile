IMAGE := xconnio/deskconn-web-app
VERSION := $(shell git describe --tags --always)

setup:
	npm install

build:
	npm run build

run:
	npm run dev

dev-local:
	VITE_WAMP_WT_URL=https://localhost:8082/wamp \
	VITE_WAMP_WT_CERT_URL=http://localhost:8083/wt-cert-hash \
	npm run dev

# dev-local-mkcert: use a mkcert-generated cert so Firefox works too.
# One-time setup:
#   sudo apt install mkcert (or: go install filippo.io/mkcert@latest)
#   mkcert -install
#   mkcert -cert-file wt.pem -key-file wt-key.pem localhost 127.0.0.1 ::1
# Then set in the router .env:
#   DESKCONN_ROUTER_QUIC_TLS_CERT=<abs-path>/wt.pem
#   DESKCONN_ROUTER_QUIC_TLS_KEY=<abs-path>/wt-key.pem
dev-local-mkcert:
	VITE_WAMP_WT_URL=https://localhost:8082/wamp \
	VITE_WAMP_WT_CERT_URL= \
	npm run dev

clean:
	rm -rf dist/ node_modules/

build-docker:
	docker build -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

run-docker:
	docker compose up web
