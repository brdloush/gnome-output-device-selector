import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as BlueZ from './lib/bluez.js';
import {
    ICON_CHOICES, btKey, displayName, loadDevices, loadKnownPorts, portKey,
    resolveIcon, saveDevices,
} from './lib/config.js';

export default class OutputDeviceSelectorPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 760);
        window.search_enabled = false;

        const page = new Adw.PreferencesPage({
            title: 'Devices',
            icon_name: 'audio-speakers-symbolic',
        });
        window.add(page);

        const ui = new DevicesUi(settings, page);
        const shortcutGroup = buildShortcutGroup(settings, window);
        page.add(shortcutGroup);

        window.connect('close-request', () => {
            ui.destroy();
            return false;
        });
    }
}

class DevicesUi {
    constructor(settings, page) {
        this._settings = settings;
        this._selfWrite = false;
        this._bt = [];
        this._rows = new Map(); // group -> rows[]

        this._chosen = new Adw.PreferencesGroup({
            title: 'Shown in the popup',
            description: 'Order here is the order in the popup. Expand a device to set an alias and icon.',
        });
        this._btGroup = new Adw.PreferencesGroup({
            title: 'Bluetooth devices',
            description: 'Paired devices that can play audio. They connect on demand when you pick them.',
        });
        const refresh = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Refresh',
            css_classes: ['flat'],
        });
        refresh.connect('clicked', () => this._loadBluetooth());
        this._btGroup.set_header_suffix(refresh);

        this._portGroup = new Adw.PreferencesGroup({
            title: 'Built-in and wired outputs',
            description: 'Speakers, headphone jack, HDMI / DisplayPort. Listed by the running extension.',
        });

        page.add(this._chosen);
        page.add(this._btGroup);
        page.add(this._portGroup);

        this._changedIds = [
            settings.connect('changed::devices', () => {
                if (!this._selfWrite)
                    this._rebuild();
            }),
            settings.connect('changed::known-ports', () => this._rebuild()),
        ];

        this._rebuild();
        this._loadBluetooth();
    }

    destroy() {
        this._changedIds.forEach(id => this._settings.disconnect(id));
        this._changedIds = [];
    }

    async _loadBluetooth() {
        this._bt = await BlueZ.listAudioDevices();
        this._rebuild();
    }

    _devices() {
        return loadDevices(this._settings);
    }

    _save(devices, rebuild = true) {
        this._selfWrite = true;
        try {
            saveDevices(this._settings, devices);
        } finally {
            this._selfWrite = false;
        }
        if (rebuild)
            this._rebuild();
    }

    _setRows(group, rows) {
        for (const row of this._rows.get(group) ?? [])
            group.remove(row);
        rows.forEach(r => group.add(r));
        this._rows.set(group, rows);
    }

    _rebuild() {
        const devices = this._devices();
        const chosenKeys = new Set(devices.map(d => d.key));

        // -- Chosen devices
        const chosenRows = devices.map((d, i) => this._chosenRow(d, i, devices.length));
        if (chosenRows.length === 0) {
            chosenRows.push(new Adw.ActionRow({
                title: 'Nothing here yet',
                subtitle: 'Add devices from the lists below.',
                sensitive: false,
            }));
        }
        this._setRows(this._chosen, chosenRows);

        // -- Bluetooth
        const btRows = this._bt.map(bt => {
            const cfg = {
                key: btKey(bt.address), type: 'bluetooth', name: bt.name,
                address: bt.address, deviceIcon: bt.icon, alias: '', icon: 'auto',
            };
            return this._candidateRow(cfg,
                `${bt.address} · ${bt.connected ? 'connected' : 'not connected'}`,
                chosenKeys.has(cfg.key));
        });
        if (btRows.length === 0) {
            btRows.push(new Adw.ActionRow({
                title: 'No paired audio devices found',
                subtitle: 'Pair headphones or speakers in Settings → Bluetooth first.',
                sensitive: false,
            }));
        }
        this._setRows(this._btGroup, btRows);

        // -- Ports
        const ports = loadKnownPorts(this._settings);
        const portRows = ports.map(p => {
            const cfg = {
                key: portKey(p.origin, p.port), type: 'port', name: p.description,
                origin: p.origin, port: p.port, alias: '', icon: 'auto',
            };
            return this._candidateRow(cfg, `${p.origin} · ${p.port}`, chosenKeys.has(cfg.key));
        });
        if (portRows.length === 0) {
            portRows.push(new Adw.ActionRow({
                title: 'No outputs listed yet',
                subtitle: 'Enable the extension. It lists outputs it sees here.',
                sensitive: false,
            }));
        }
        this._setRows(this._portGroup, portRows);
    }

    _candidateRow(cfg, subtitle, added) {
        const row = new Adw.ActionRow({title: escape(cfg.name), subtitle: escape(subtitle)});
        row.add_prefix(new Gtk.Image({icon_name: resolveIcon(cfg), pixel_size: 20}));

        if (added) {
            row.add_suffix(new Gtk.Label({label: 'Added', css_classes: ['dim-label']}));
        } else {
            const add = new Gtk.Button({
                icon_name: 'list-add-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Add to popup',
                css_classes: ['flat', 'circular'],
            });
            add.connect('clicked', () => this._save([...this._devices(), cfg]));
            row.add_suffix(add);
            row.activatable_widget = add;
        }
        return row;
    }

    _chosenRow(device, index, count) {
        const kind = device.type === 'bluetooth' ? 'Bluetooth' : device.origin;
        const row = new Adw.ExpanderRow({
            title: escape(displayName(device)),
            subtitle: escape(device.alias?.trim() ? `${device.name} · ${kind}` : kind),
        });
        const icon = new Gtk.Image({icon_name: resolveIcon(device), pixel_size: 20});
        row.add_prefix(icon);

        const button = (iconName, tooltip, sensitive, onClick) => {
            const b = new Gtk.Button({
                icon_name: iconName,
                tooltip_text: tooltip,
                valign: Gtk.Align.CENTER,
                sensitive,
                css_classes: ['flat', 'circular'],
            });
            b.connect('clicked', onClick);
            row.add_suffix(b);
        };
        const move = delta => {
            const list = this._devices();
            const i = list.findIndex(d => d.key === device.key);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= list.length)
                return;
            [list[i], list[j]] = [list[j], list[i]];
            this._save(list);
        };
        // ExpanderRow shows suffixes in reverse order of adding.
        button('user-trash-symbolic', 'Remove from popup', true,
            () => this._save(this._devices().filter(d => d.key !== device.key)));
        button('go-down-symbolic', 'Move down', index < count - 1, () => move(1));
        button('go-up-symbolic', 'Move up', index > 0, () => move(-1));

        const update = patch => {
            const list = this._devices();
            const d = list.find(x => x.key === device.key);
            if (!d)
                return;
            Object.assign(d, patch);
            Object.assign(device, patch);
            this._save(list, false);
            row.title = escape(displayName(d));
            row.subtitle = escape(d.alias?.trim() ? `${d.name} · ${kind}` : kind);
            icon.icon_name = resolveIcon(d);
        };

        const aliasRow = new Adw.EntryRow({title: 'Alias (optional)', text: device.alias ?? ''});
        aliasRow.connect('changed', () => update({alias: aliasRow.text}));
        row.add_row(aliasRow);

        const model = Gtk.StringList.new(ICON_CHOICES.map(c => c.label));
        const iconRow = new Adw.ComboRow({title: 'Icon', model});
        const current = ICON_CHOICES.findIndex(c => c.id === (device.icon || 'auto'));
        iconRow.selected = Math.max(0, current);
        iconRow.connect('notify::selected', () => update({icon: ICON_CHOICES[iconRow.selected].id}));
        row.add_row(iconRow);

        return row;
    }
}

function escape(text) {
    return GLib.markup_escape_text(`${text ?? ''}`, -1);
}

function buildShortcutGroup(settings, window) {
    const group = new Adw.PreferencesGroup({
        title: 'Shortcut',
        description: 'GNOME also uses Super+D for “Hide all normal windows”. Remove that one in ' +
            'Settings → Keyboard → View and Customize Shortcuts → Navigation if both react.',
    });

    const row = new Adw.ActionRow({title: 'Open the popup'});
    const label = new Gtk.ShortcutLabel({
        disabled_text: 'Disabled',
        valign: Gtk.Align.CENTER,
    });
    const sync = () => {
        label.accelerator = settings.get_strv('toggle-popup')[0] ?? '';
    };
    sync();
    const changedId = settings.connect('changed::toggle-popup', sync);
    window.connect('close-request', () => {
        settings.disconnect(changedId);
        return false;
    });

    const edit = new Gtk.Button({label: 'Change…', valign: Gtk.Align.CENTER});
    row.add_suffix(label);
    row.add_suffix(edit);
    row.activatable_widget = edit;
    group.add(row);

    edit.connect('clicked', () => {
        const dialog = new Adw.AlertDialog({
            heading: 'Press the new shortcut',
            body: 'Esc cancels. Backspace disables the shortcut.',
        });
        dialog.add_response('cancel', 'Cancel');
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (!mods && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!mods && keyval === Gdk.KEY_BackSpace) {
                settings.set_strv('toggle-popup', []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (isModifierKey(keyval) || !Gtk.accelerator_valid(keyval, mods))
                return Gdk.EVENT_STOP;
            settings.set_strv('toggle-popup', [Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mods)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present(window);
    });

    return group;
}

function isModifierKey(keyval) {
    return [
        Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R,
        Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R,
        Gdk.KEY_Meta_L, Gdk.KEY_Meta_R, Gdk.KEY_ISO_Level3_Shift,
    ].includes(keyval);
}
