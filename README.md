# Output Device Selector

A GNOME Shell extension (GNOME 48–50). Press **Super+D** to open a small popup and pick your audio output.

- Shows only the devices you chose, in your order, with your own names (aliases) and icons.
- Opens with the current output selected and marked with a check.
- Bluetooth devices show **Connected** / **Disconnected**. Picking a disconnected one connects it first, then switches to it.
- Unplugged outputs (e.g. an empty headphone jack) show **Unplugged** and cannot be picked.

## Keys

| Key | Action |
| --- | --- |
| ← → ↑ ↓ / h l k j / Tab | Move |
| 1 – 9 | Switch to that device directly |
| Enter / Space | Switch to the selected device |
| Esc / q / Super+D | Close |

The mouse also works: click a card to switch, click outside to close.

## Install

```sh
./install.sh
```

The script:

1. compiles the settings schema,
2. links this folder to `~/.local/share/gnome-shell/extensions/output-device-selector@brdloush`,
3. adds the extension to the enabled list,
4. removes `Super+D` from GNOME's "Hide all normal windows" shortcut, because both cannot use it.

On Wayland, log out and back in once. Then open the settings:

```sh
gnome-extensions prefs output-device-selector@brdloush
```

Add devices with **+**. Expand a chosen device to set an alias and an icon. Use the arrows to change the order. You can also change the shortcut there.

## How it works

- `lib/audio.js` reads outputs through Gvc, the same library as GNOME's sound menu, and switches with `change_output()`. This also switches the card profile when needed (e.g. to HDMI).
- `lib/bluez.js` talks to BlueZ on the system D-Bus: it lists paired audio devices, watches their connection state, and calls `Device1.Connect()`. It powers on the adapter if it is off.
- Wired outputs are stored as *card name + port name*. Bluetooth devices are stored by MAC address.
- The running extension writes the outputs it sees to the `known-ports` key, so the settings window can list them.

## Load code changes without logging out

```sh
./dev-reload.sh
```

This copies the extension to a fresh folder under `~/.cache/ods-dev/` and puts a one-line command on the clipboard. Then press Alt+F2, type `lg`, press Enter, paste the line, press Enter, then press Esc.

Why a fresh folder: GNOME Shell caches each loaded file by its path, so loading the same folder again runs the old code. For the same reason, class names (`lib/gtype.js`) include a hash of the folder path.

## Debug

```sh
journalctl -f -o cat /usr/bin/gnome-shell | grep -i output-device
```
