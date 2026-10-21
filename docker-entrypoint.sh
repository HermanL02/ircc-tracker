#!/bin/sh
# Start a virtual display for headed Chrome. xvfb-run hangs when it is PID 1,
# so run Xvfb directly and hand the process over to Node.
set -e
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp &
export DISPLAY=:99
exec "$@"
