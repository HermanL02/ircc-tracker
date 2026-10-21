#!/bin/sh
# Start a virtual display for headed Chrome. xvfb-run hangs when it is PID 1,
# so run Xvfb directly and hand the process over to Node.
set -e
N="${XVFB_DISPLAY:-99}"
rm -f "/tmp/.X${N}-lock"
Xvfb ":${N}" -screen 0 1280x900x24 -nolisten tcp &
export DISPLAY=":${N}"
# On a desktop, systemd user services inherit the Wayland session and Chrome
# would open its window there instead of on Xvfb.
unset WAYLAND_DISPLAY
export XDG_SESSION_TYPE=x11
exec "$@"
