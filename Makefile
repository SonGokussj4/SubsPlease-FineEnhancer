.SILENT:
.ONESHELL:
.DEFAULT_GOAL := help

.PHONY: help help-md bootstrap doctor test check lint typecheck clean

# GNU Make does not split SHELL on spaces, so "/usr/bin/env bash" is looked up
# as a single filename and fails. Resolve bash from PATH, falling back to sh.
BASH := $(shell command -v bash 2>/dev/null)
SHELL := $(if $(BASH),$(BASH),/bin/sh)

# Displaying help without colors, set NO_COLOR=1 in the environment
ifeq ($(NO_COLOR),1)
  COLOR =
  RESET =
else
  COLOR = \033[36m
  RESET = \033[0m
endif

# ==================================================================
# Project Settings
# ==================================================================
SCRIPT := src/subsplease-fine-enhancer.user.js
REMOTE ?= origin
NODE_MIN := 18
CURRENT_VERSION := $(shell grep -m1 '^// @version' $(SCRIPT) | awk '{print $$3}')
NEW_VERSION ?= $(CURRENT_VERSION)


# ==================================================================
# General Help Command
# ==================================================================
help:  ## Show this help with grouped commands.
	@awk 'BEGIN {FS = ":.*##"; maxlen=0} /^[a-zA-Z0-9_.@%-]+:.*?##/ { target=$$1; s=$$2; if (index(s, ":")) { split(s, parts, ":"); group=parts[1]; desc=substr(s, index(s, ":") + 1); } else { group=" General"; sub(/^[ \t]+/, " ", s); desc=s; } if (!(group in seen)) { groups[++g]=group; seen[group]=1 } if (length(target) > maxlen) maxlen=length(target); entries[group]=entries[group] target "\t" desc "\n"; } END { printf "\nUsage:\n  make $(COLOR)<Subcommand> <Enter>$(RESET)\t(default: help)\n\nSubcommands:\n"; for (i=1; i<=g; i++) { grp=groups[i]; printf "\n%s\n", grp; n=split(entries[grp], lines, "\n"); for (j=1; j<=n; j++) { if (lines[j]=="") continue; split(lines[j], parts, "\t"); printf "  $(COLOR)%-*s$(RESET) %s\n", maxlen, parts[1], parts[2]; } } printf "\n"; }' $(MAKEFILE_LIST)
#       @awk 'BEGIN {FS = ":.*##"; maxlen=0} \
#       /^[a-zA-Z0-9_.@%-]+:.*?##/ { \
#               target=$$1; s=$$2; \
#               if (index(s, ":")) { \
#                       split(s, parts, ":"); \
#                       group=parts[1]; \
#                       desc=substr(s, index(s, ":") + 1); \
#               } else { \
#                       group=" General"; \
#                       sub(/^[ \t]+/, " ", s); \
#                       desc=s; \
#               } \
#               if (!(group in seen)) { groups[++g]=group; seen[group]=1 } \
#               if (length(target) > maxlen) maxlen=length(target); \
#               entries[group]=entries[group] target "\t" desc "\n"; \
#       } \
#       END { \
#               printf "\nUsage:\n  make $(COLOR)<Subcommand> <Enter>$(RESET)\t(default: help)\n\nSubcommands:\n"; \
#               for (i=1; i<=g; i++) { \
#                       grp=groups[i]; \
#                       printf "\n%s\n", grp; \
#                       n=split(entries[grp], lines, "\n"); \
#                       for (j=1; j<=n; j++) { \
#                               if (lines[j]=="") continue; \
#                               split(lines[j], parts, "\t"); \
#                               printf "  $(COLOR)%-*s$(RESET) %s\n", maxlen, parts[1], parts[2]; \
#                       } \
#               } \
#               printf "\n"; \
#       }' $(MAKEFILE_LIST)


help-md:  ## Generate HELP.md file with the same content as `make help`
	@echo "Generating HELP.md file..."
	@echo "<!-- This file is auto-generated. Do not edit directly. -->" > HELP.md
	@echo "<!-- To update, run 'make help-md' -->" >> HELP.md
	@echo "" >> HELP.md
	@echo "## Available Makefile Commands" >> HELP.md
	@echo "" >> HELP.md
	@echo '```bash' >> HELP.md
	@NO_COLOR=1 $(MAKE) --no-print-directory help >> HELP.md
	@echo '```' >> HELP.md


# ==================================================================
# Makefile Commands
# The format for command help is:
#   <command>:  ## [<Group>:] <Description>
# ==================================================================

bump-version:  ## Dev: Bump version (Usage: make bump-version NEW_VERSION=x.y.z)
	@if [ "$(NEW_VERSION)" = "$(CURRENT_VERSION)" ]; then \
		echo "Error: NEW_VERSION must be different from CURRENT_VERSION ($(CURRENT_VERSION))"; \
		exit 1; \
	fi
	@echo "Bumping version from $(CURRENT_VERSION) to $(NEW_VERSION)..."
	@sed -i.bak "s|^// @version .*|// @version      $(NEW_VERSION)|" $(SCRIPT)
	@rm -f $(SCRIPT).bak
	@echo "Version bumped to $(NEW_VERSION) in $(SCRIPT)."

release:  ## Dev: Upload current script to Userscript
	@echo "Releasing version $(NEW_VERSION) to Userscripts..."
	@curl -X POST -F "script=@$(SCRIPT)" https://userscripts.org/scripts/publish
	@echo "Released version $(NEW_VERSION) to Userscripts."

# ==================================================================
# Development: setup, checks and tests
# ==================================================================

bootstrap:  ## Dev: Install everything needed to run the tests
	@command -v node >/dev/null 2>&1 || { echo "Error: node is not installed (need v$(NODE_MIN)+). See https://nodejs.org"; exit 1; }
	@echo "Installing npm dependencies..."
	@npm install --no-audit --no-fund
	@if [ -n "$$PLAYWRIGHT_BROWSERS_PATH" ] && [ -d "$$PLAYWRIGHT_BROWSERS_PATH" ]; then \
		echo "Using preinstalled browsers from $$PLAYWRIGHT_BROWSERS_PATH"; \
	else \
		echo "Installing the Chromium build Playwright drives..."; \
		npx --yes playwright install chromium; \
	fi
	@echo ""
	@echo "Done. Run 'make test'."

doctor:  ## Dev: Check that everything needed for development is present
	@echo "Checking the development environment..."
	@ok=1; \
	if command -v node >/dev/null 2>&1; then \
		v=$$(node -v); maj=$$(echo $$v | sed 's/v\([0-9]*\).*/\1/'); \
		if [ "$$maj" -ge "$(NODE_MIN)" ]; then echo "  [ok]   node $$v"; \
		else echo "  [FAIL] node $$v is older than v$(NODE_MIN)"; ok=0; fi; \
	else echo "  [FAIL] node is not installed - see https://nodejs.org"; ok=0; fi; \
	if command -v npm >/dev/null 2>&1; then echo "  [ok]   npm $$(npm -v)"; \
	else echo "  [FAIL] npm is not installed"; ok=0; fi; \
	if [ -d node_modules/playwright ]; then echo "  [ok]   playwright installed"; \
	else echo "  [FAIL] playwright missing - run 'make bootstrap'"; ok=0; fi; \
	if [ -d node_modules/typescript ]; then echo "  [ok]   typescript installed"; \
	else echo "  [warn] typescript missing - 'make check' needs it ('make bootstrap')"; fi; \
	if node -e "const{chromium}=require('playwright');const p=process.env.PLAYWRIGHT_CHROMIUM_PATH||(require('fs').existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':null);const o=p?{executablePath:p}:{};chromium.launch(o).then(b=>b.close()).catch(e=>{console.error(e.message);process.exit(1)})" >/dev/null 2>&1; then \
		echo "  [ok]   chromium launches"; \
	else echo "  [FAIL] chromium cannot launch - run 'make bootstrap'"; ok=0; fi; \
	if [ -f $(SCRIPT) ]; then echo "  [ok]   $(SCRIPT)"; \
	else echo "  [FAIL] $(SCRIPT) is missing"; ok=0; fi; \
	echo ""; \
	if [ "$$ok" = "1" ]; then echo "All good - run 'make test'."; \
	else echo "Some checks failed - run 'make bootstrap'."; exit 1; fi

test:  ## Dev: Run the test suite (SPEC=name runs one spec, VERBOSE=1 lists every check)
	@if [ ! -d node_modules/playwright ]; then echo "playwright is missing - run 'make bootstrap' first."; exit 1; fi
	@node test/run.js $(SPEC)

check: lint typecheck  ## Dev: Run all static checks (metadata, syntax, types)

lint:  ## Dev: Check userscript syntax and header metadata
	@node --check $(SCRIPT)
	@echo "syntax ok: $(SCRIPT)"
	@for f in test/run.js test/lib/*.js test/specs/*.js test/checks/*.js; do node --check "$$f" || exit 1; done
	@echo "syntax ok: test/"
	@node test/checks/metadata.js

typecheck:  ## Dev: Type-check the userscript with TypeScript in checkJs mode
	@if [ ! -d node_modules/typescript ]; then echo "typescript is missing - run 'make bootstrap' first."; exit 1; fi
	@npx --no-install tsc -p jsconfig.json && echo "typecheck ok"

clean:  ## Dev: Remove installed dependencies and test artifacts
	@rm -rf node_modules test/.artifacts
	@echo "Cleaned."
