#!/usr/bin/env bash
# Installs the extension for the current user (as a symlink to this folder).
set -euo pipefail

UUID=output-device-selector@brdloush
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

# Prefer the system tools: other copies (e.g. Homebrew) may not talk to dconf.
GSETTINGS=$( [ -x /usr/bin/gsettings ] && echo /usr/bin/gsettings || command -v gsettings )
COMPILE=$( [ -x /usr/bin/glib-compile-schemas ] && echo /usr/bin/glib-compile-schemas || command -v glib-compile-schemas )

"$COMPILE" --strict "$SRC/schemas"
mkdir -p "$(dirname "$DEST")"
ln -sfn "$SRC" "$DEST"
echo "Linked $DEST -> $SRC"

# Add to enabled extensions.
python3 - "$GSETTINGS" "$UUID" <<'PY'
import ast, subprocess, sys
gs, uuid = sys.argv[1], sys.argv[2]
raw = subprocess.check_output([gs, 'get', 'org.gnome.shell', 'enabled-extensions'], text=True).strip()
cur = ast.literal_eval(raw.removeprefix('@as '))
if uuid not in cur:
    subprocess.check_call([gs, 'set', 'org.gnome.shell', 'enabled-extensions', str(cur + [uuid])])
    print(f'Enabled {uuid}')
PY

# GNOME binds Super+D to "Hide all normal windows". Free it, or the popup never opens.
python3 - "$GSETTINGS" <<'PY'
import ast, subprocess, sys
gs = sys.argv[1]
key = ['org.gnome.desktop.wm.keybindings', 'show-desktop']
raw = subprocess.check_output([gs, 'get', *key], text=True).strip()
cur = ast.literal_eval(raw.removeprefix('@as '))
new = [k for k in cur if k.lower() != '<super>d']
if new != cur:
    subprocess.check_call([gs, 'set', *key, str(new) if new else '[]'])
    print(f'Removed <Super>d from "Hide all normal windows" (now: {new})')
PY

echo
echo "Done. On Wayland, log out and back in once so GNOME Shell loads the extension."
echo "Then pick devices with:  gnome-extensions prefs $UUID"
