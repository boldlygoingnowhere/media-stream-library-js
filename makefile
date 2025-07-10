LIBNAME = media-stream-library
DEBUG?=no
NODE_OPTIONS=--openssl-legacy-provider

ifeq ($(DEBUG), yes)
YARN_TARGET = build:bundle-dev
INSTALL_FILE_IN = dist/media-stream-library.legacy.dev.js
else
YARN_TARGET = build:bundle-legacy
INSTALL_FILE_IN = dist/media-stream-library.legacy.min.js
endif

INSTALL_FILE_OUT = media-stream-library.js
EXTRA_INSTALL_FILES = 

default: usage 

usage:
	@echo ================================================
	@echo -- Usage:
	@echo --- make prepare: prepare lib for building
	@echo --- make build: build lib
	@echo --- make clean: clean lib 
	@echo --- make install: install lib
	@echo ================================================

prepare:
	@echo ===================================
	@echo "Preparing $(LIBNAME)"
	@echo ===================================
#cypress installation does not currently wotk on ABIP/HSIP build VM
#It is not needed anyway but a side effect is that part of the yarn cache is deleted and yarn.lock is updated
	sed -i '/cypress/d' package.json
#Install dependencies from yarn cache
	export NODE_OPTIONS=${NODE_OPTIONS} && npm install > /dev/null

build:
	@echo ==================================
	@echo "Building $(LIBNAME)"
	@echo ==================================
	export NODE_OPTIONS=${NODE_OPTIONS} && npm run $(YARN_TARGET)

install:
ifndef DESTDIR 
	$(error DESTDIR is NOT defined!)
else
	@echo ==============================================================
	@echo "Installing $(LIBNAME) to $(DESTDIR)"
	@echo ==============================================================
	@install -D -T $(INSTALL_FILE_IN) $(DESTDIR)/lib/$(INSTALL_FILE_OUT)
	@for file in $(EXTRA_INSTALL_FILES); do install -D $(DESTDIR) $$file; done
endif

clean:
	@echo ==================================
	@echo "Cleaning $(LIBNAME)"
	@echo ==================================
	@rm -f dist/*

.PHONY: default usage prepare build install clean
