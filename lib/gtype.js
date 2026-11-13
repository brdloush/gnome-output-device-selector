// GObject type names must be unique in the whole gnome-shell process.
// dev-reload.sh loads fresh copies of this extension from new folders, so
// derive a suffix from this file's location instead of using fixed names.
let hash = 0;
for (const ch of import.meta.url)
    hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;

export function typeName(name) {
    return `OutputDeviceSelector_${name}_${hash.toString(36)}`;
}
