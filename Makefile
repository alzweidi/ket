CC = cc
CPPFLAGS = -Inative/include
CFLAGS = -std=c17 -O2 -Wall -Wextra -Wpedantic -Werror
LDLIBS = -lm
BUILD = build
EMCC = emcc
PKG_CONFIG = pkg-config
IBM_CFLAGS = $(shell $(PKG_CONFIG) --cflags libcurl json-c)
IBM_LIBS = $(shell $(PKG_CONFIG) --libs libcurl json-c)
CORE = native/src/ir.c native/src/frontend.c native/src/simulator.c native/src/qasm.c
CLI = native/src/main.c native/src/output.c native/src/viz.c native/src/config.c native/src/ibm.c native/src/device.c
HEADERS = native/include/ket.h native/src/ir.h native/src/output.h native/src/ibm.h
WEB = playground/engine

.PHONY: all test sanitise wasm playground serve test-web fringes clean
all: $(BUILD)/ket

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/ket: $(CORE) $(CLI) $(HEADERS) | $(BUILD)
	$(CC) $(CPPFLAGS) $(IBM_CFLAGS) $(CFLAGS) $(CORE) $(CLI) $(LDFLAGS) $(LDLIBS) $(IBM_LIBS) -o $@

$(BUILD)/test-ir: $(CORE) native/tests/test_ir.c $(HEADERS) | $(BUILD)
	$(CC) $(CPPFLAGS) -Inative/src $(CFLAGS) $(CORE) native/tests/test_ir.c $(LDFLAGS) $(LDLIBS) -o $@

$(BUILD)/test-ibm: $(CORE) $(CLI) $(HEADERS) | $(BUILD)
	$(CC) $(CPPFLAGS) $(IBM_CFLAGS) $(CFLAGS) -DKET_IBM_TEST $(CORE) $(CLI) $(LDFLAGS) $(LDLIBS) $(IBM_LIBS) -o $@

test: $(BUILD)/ket $(BUILD)/test-ir $(BUILD)/test-ibm $(BUILD)/fringes
	$(BUILD)/fringes examples/fringes.ket --frames > /dev/null
	$(BUILD)/test-ir
	python3 native/tests/test_native.py $(BUILD)/ket
	python3 native/tests/test_ibm.py $(BUILD)/test-ibm

sanitise:
	UBSAN_OPTIONS=halt_on_error=1 $(MAKE) BUILD=build/sanitise CC=clang CFLAGS='-std=c17 -O1 -g -Wall -Wextra -Wpedantic -Werror -fsanitize=address,undefined -fno-omit-frame-pointer' LDFLAGS='-fsanitize=address,undefined' test

wasm:
	mkdir -p $(WEB)
	$(EMCC) -Inative/include -std=c17 -O2 -Wall -Wextra -Werror $(CORE) native/src/output.c native/src/web.c --no-entry \
		-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createKet -sENVIRONMENT=worker,node \
		-sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=2097152 -sFILESYSTEM=0 \
		-sEXPORTED_FUNCTIONS=_ket_web,_malloc,_free -sEXPORTED_RUNTIME_METHODS=ccall,UTF8ToString -o $(WEB)/ket.mjs
	chmod 644 $(WEB)/ket.wasm

playground:
	mkdir -p $(BUILD)/playground/engine $(BUILD)/playground/examples
	cp playground/index.html playground/style.css playground/app.js playground/worker.mjs playground/favicon.svg $(BUILD)/playground/
	cp $(WEB)/ket.mjs $(WEB)/ket.wasm $(WEB)/NOTICE.txt $(BUILD)/playground/engine/
	cp examples/*.ket $(BUILD)/playground/examples/

serve: playground
	python3 -m http.server 8417 --bind 127.0.0.1 --directory $(BUILD)/playground

test-web: $(BUILD)/ket
	node native/tests/test_web.mjs $(BUILD)/ket

$(BUILD)/fringes: $(CORE) examples/terminal/fringes.c $(HEADERS) | $(BUILD)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(CORE) examples/terminal/fringes.c $(LDFLAGS) $(LDLIBS) -o $@

fringes: $(BUILD)/fringes
	$(BUILD)/fringes examples/fringes.ket

clean:
	rm -rf build
