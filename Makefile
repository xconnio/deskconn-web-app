setup:
	yarn install

build:
	yarn build --base=/app/

run:
	yarn dev

clean:
	rm -rf dist/ node_modules/
