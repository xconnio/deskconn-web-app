IMAGE := xconnio/deskconn-web-app
VERSION := $(shell git describe --tags --always)

setup:
	npm install

build:
	npm run build

run:
	npm run dev

clean:
	rm -rf dist/ node_modules/

build-docker:
	docker build -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

run-docker:
	docker compose up web
