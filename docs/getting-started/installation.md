# installation

Ket builds on macOS and Linux using a C17 compiler, Make, pkg-config, libcurl and json-c.

Install the macOS libraries with Homebrew.

```sh
brew install pkg-config json-c
make
```

Install the Debian or Ubuntu development packages with APT.

```sh
sudo apt-get install build-essential pkg-config libcurl4-openssl-dev libjson-c-dev
make
```

```sh
./build/ket --version
./build/ket check examples/bell-state.ket
./build/ket run examples/bell-state.ket --shots 1024
```

## playground

`make playground` assembles the static site in `build/playground`. Use `make serve` with Python 3 to open it on [localhost](http://127.0.0.1:8417). Its static files can also be copied to a web server.

To rebuild the browser engine from C, activate Emscripten 4.0.23, run `make wasm`, then `make test-web`. The latter compares the new module with the native executable using Node. Both tools are used in development. [Emscripten SDK setup](https://emscripten.org/docs/getting_started/downloads.html)
