.SILENT:
.ONESHELL:
.DEFAULT_GOAL := help

.PHONY: help help-md

SHELL := /usr/bin/env bash

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
SCRIPT := src/subsplease-imgpreview.js
REMOTE ?= origin
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
