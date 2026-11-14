CC = cc
CPPFLAGS = -Inative/include
CFLAGS = -std=c17 -O2 -Wall -Wextra -Wpedantic -Werror
LDLIBS = -lm
BUILD = build
CORE = native/src/frontend.c native/src/simulator.c native/src/qasm.c

.PHONY: all test sanitise clean
all: $(BUILD)/ket

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/ket: $(CORE) native/src/main.c native/include/ket.h | $(BUILD)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(CORE) native/src/main.c $(LDFLAGS) $(LDLIBS) -o $@

test: $(BUILD)/ket
	python3 native/tests/test_native.py $(BUILD)/ket

sanitise:
	UBSAN_OPTIONS=halt_on_error=1 $(MAKE) BUILD=build/sanitise CC=clang CFLAGS='-std=c17 -O1 -g -Wall -Wextra -Wpedantic -Werror -fsanitize=address,undefined -fno-omit-frame-pointer' LDFLAGS='-fsanitize=address,undefined' test

clean:
	rm -rf build
