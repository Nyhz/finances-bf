#!/bin/bash
# finances-xbar-run.sh — headless wrapper for xbar menu actions
# Runs finances-ctl.sh commands via osascript so launchctl has
# a proper login session context, without opening a Terminal window.

CMD="$1"
CTL="$HOME/devroom/battlefields/finances/scripts/finances-ctl.sh"

osascript -e "do shell script \"'${CTL}' ${CMD}\"" &>/dev/null &
