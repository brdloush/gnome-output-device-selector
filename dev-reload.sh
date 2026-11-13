#!/usr/bin/env bash
# Load the current code into the running GNOME Shell without logging out.
#
# GNOME Shell caches extension modules by file path, so re-loading the same
# folder gives you the old code. This script copies the extension to a fresh
# folder and points ~/.cache/ods-dev/current at it. The Looking Glass line
# below unloads the running copy and loads the one "current" points to.
set -euo pipefail

UUID=output-device-selector@brdloush
SRC="$(cd "$(dirname "$0")" && pwd)"
BASE="${XDG_CACHE_HOME:-$HOME/.cache}/ods-dev"
SNAP="$BASE/$(date +%Y%m%d-%H%M%S-%N)/$UUID"
COMPILE=$( [ -x /usr/bin/glib-compile-schemas ] && echo /usr/bin/glib-compile-schemas || command -v glib-compile-schemas )

"$COMPILE" --strict "$SRC/schemas"
mkdir -p "$SNAP"
cp -r "$SRC"/metadata.json "$SRC"/extension.js "$SRC"/prefs.js "$SRC"/stylesheet.css "$SRC"/lib "$SRC"/schemas "$SNAP"/
ln -sfn "$SNAP" "$BASE/current"

# Keep the 3 newest copies.
ls -1dt "$BASE"/2*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

LINE="(async()=>{const G=imports.gi,em=Main.extensionManager,u='$UUID',p=G.GLib.file_read_link(G.GLib.get_user_cache_dir()+'/ods-dev/current');const o=em.lookup(u);if(o)await em.unloadExtension(o);await em.loadExtension(em.createExtensionObject(u,G.Gio.File.new_for_path(p),2));})()"

echo "Copied to $SNAP"
if command -v wl-copy >/dev/null && [ -n "${WAYLAND_DISPLAY:-}" ]; then
    printf '%s' "$LINE" | wl-copy
    echo "Looking Glass line copied to clipboard."
fi
echo
echo "Now: Alt+F2 → lg → Enter → paste (Ctrl+V) → Enter → Esc"
echo
echo "$LINE"
