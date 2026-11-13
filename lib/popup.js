// The Super+D popup: a row of device cards, keyboard driven.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {displayName, resolveIcon} from './config.js';
import {typeName} from './gtype.js';

const FADE_MS = 140;

const DeviceCard = GObject.registerClass({
    GTypeName: typeName('DeviceCard'),
    Signals: {'hovered': {}},
}, class DeviceCard extends St.Button {
    _init(item, index) {
        super._init({
            style_class: 'ods-card',
            reactive: true,
            can_focus: false,
            track_hover: true,
            button_mask: St.ButtonMask.ONE,
        });

        // Card content plus a small number hint floating in the top-left corner.
        const overlay = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'ods-card-box',
            x_expand: true,
        });
        overlay.add_child(box);
        this.set_child(overlay);

        // Icon bubble with an "active" check badge in the corner.
        const iconStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._bubble = new St.Bin({
            style_class: 'ods-bubble',
            child: new St.Icon({
                icon_name: resolveIcon(item.cfg),
                style_class: 'ods-device-icon',
            }),
        });
        this._badge = new St.Bin({
            style_class: 'ods-badge',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
            child: new St.Icon({icon_name: 'object-select-symbolic', style_class: 'ods-badge-icon'}),
        });
        iconStack.add_child(this._bubble);
        iconStack.add_child(this._badge);
        box.add_child(iconStack);

        this._name = new St.Label({
            style_class: 'ods-name',
            text: displayName(item.cfg),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._name);

        const alias = (item.cfg.alias ?? '').trim();
        const subText = alias && alias !== item.cfg.name
            ? item.cfg.name
            : (item.cfg.type === 'bluetooth' ? 'Bluetooth' : item.cfg.origin);
        this._sub = new St.Label({
            style_class: 'ods-sub',
            text: subText ?? '',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._sub);

        this._status = new St.BoxLayout({style_class: 'ods-status', x_align: Clutter.ActorAlign.CENTER});
        this._dot = new St.Widget({style_class: 'ods-dot', y_align: Clutter.ActorAlign.CENTER});
        this._statusLabel = new St.Label({style_class: 'ods-status-label', y_align: Clutter.ActorAlign.CENTER});
        this._status.add_child(this._dot);
        this._status.add_child(this._statusLabel);
        box.add_child(this._status);

        this._hint = new St.Label({
            style_class: 'ods-key-hint',
            text: index < 9 ? `${index + 1}` : '',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
        });
        overlay.add_child(this._hint);

        this.connect('motion-event', () => {
            this.emit('hovered');
            return Clutter.EVENT_PROPAGATE;
        });

        this._override = null;
        this.update(item);
    }

    /** Temporary status while connecting/failing: {kind, text} or null. */
    setOverride(override) {
        this._override = override;
        this.update(this.item);

        this._dot.remove_all_transitions();
        this._dot.opacity = 255;
        if (override?.kind === 'busy') {
            this._dot.ease({
                opacity: 50,
                duration: 550,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1,
                autoReverse: true,
            });
        }
    }

    update(item) {
        this.item = item;
        const set = (cls, on) => on ? this.add_style_class_name(cls) : this.remove_style_class_name(cls);

        set('ods-active', item.active);
        set('ods-unavailable', !item.available && !this._override);
        this._badge.visible = item.active;

        let kind, text;
        if (this._override) {
            ({kind, text} = this._override);
        } else if (item.hasConnection) {
            if (!item.known && !item.connected) {
                kind = 'off';
                text = 'Not paired';
            } else {
                kind = item.connected ? 'on' : 'off';
                text = item.connected ? 'Connected' : 'Disconnected';
            }
        } else if (!item.available) {
            kind = 'off';
            text = item.known ? 'Unplugged' : 'Not found';
        } else if (item.active) {
            kind = 'on';
            text = 'In use';
        } else {
            kind = 'none';
            text = 'Ready';
        }

        for (const k of ['on', 'off', 'busy', 'error', 'none'])
            this._status.remove_style_class_name(`ods-status-${k}`);
        this._status.add_style_class_name(`ods-status-${kind}`);
        this._statusLabel.text = text;
    }

    set selected(value) {
        if (value)
            this.add_style_class_name('ods-selected');
        else
            this.remove_style_class_name('ods-selected');
    }

    shake() {
        this.remove_all_transitions();
        const steps = [8, -8, 6, -6, 3, 0];
        const next = i => {
            if (i >= steps.length)
                return;
            this.ease({
                translation_x: steps[i],
                duration: 45,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => next(i + 1),
            });
        };
        next(0);
    }
});

export const SelectorPopup = GObject.registerClass({
    GTypeName: typeName('SelectorPopup'),
    Signals: {'closed': {}},
}, class SelectorPopup extends St.Widget {
    _init(backend, {openPrefs}) {
        super._init({
            style_class: 'ods-backdrop',
            reactive: true,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });
        this._backend = backend;
        this._openPrefs = openPrefs;
        this._cards = [];
        this._selected = 0;
        this._busy = false;
        this._closing = false;
        this._grab = null;
        this._pressedCard = -1;

        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        const area = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        this.add_child(area);

        this._panel = new St.BoxLayout({
            style_class: 'ods-panel',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        area.add_child(this._panel);

        const header = new St.BoxLayout({style_class: 'ods-header', x_align: Clutter.ActorAlign.CENTER});
        header.add_child(new St.Icon({icon_name: 'audio-volume-high-symbolic', style_class: 'ods-header-icon'}));
        header.add_child(new St.Label({text: 'Sound Output', style_class: 'ods-title', y_align: Clutter.ActorAlign.CENTER}));
        this._panel.add_child(header);

        const items = backend.getItems();
        if (items.length === 0) {
            this._panel.add_child(new St.Label({
                style_class: 'ods-empty',
                text: 'No devices chosen yet.\nPress Enter to open the settings and pick some.',
                x_align: Clutter.ActorAlign.CENTER,
            }));
        } else {
            const row = new St.BoxLayout({style_class: 'ods-cards', x_align: Clutter.ActorAlign.CENTER});
            items.forEach((item, i) => {
                const card = new DeviceCard(item, i);
                card.connect('hovered', () => this._select(i));
                row.add_child(card);
                this._cards.push(card);
            });
            this._panel.add_child(row);
        }

        this._footer = new St.Label({
            style_class: 'ods-footer',
            text: items.length
                ? '←/→  h/l   move     1–9   jump     Enter   switch     Esc   close'
                : 'Enter   settings     Esc   close',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._panel.add_child(this._footer);

        const activeIndex = items.findIndex(it => it.active);
        this._select(activeIndex >= 0 ? activeIndex : 0);

        backend.connectObject('changed', () => this._refresh(), this);
        backend.refreshBluetooth();
    }

    open() {
        Main.layoutManager.uiGroup.add_child(this);
        this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.SYSTEM_MODAL});
        global.stage.set_key_focus(this);

        this.opacity = 0;
        this.ease({opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._panel.set_pivot_point(0.5, 0.5);
        this._panel.scale_x = this._panel.scale_y = 0.94;
        this._panel.ease({
            scale_x: 1,
            scale_y: 1,
            duration: FADE_MS + 60,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        return true;
    }

    close() {
        if (this._closing)
            return;
        this._closing = true;
        this._backend.disconnectObject(this);
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.reactive = false;
        this.ease({
            opacity: 0,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                this.emit('closed');
                this.destroy();
            },
        });
    }

    _refresh() {
        if (this._closing)
            return;
        const items = this._backend.getItems();
        if (items.length !== this._cards.length)
            return; // config changed while open; next open picks it up
        items.forEach((item, i) => this._cards[i].update(item));
    }

    _select(index) {
        if (this._cards.length === 0)
            return;
        const n = this._cards.length;
        this._selected = ((index % n) + n) % n;
        this._cards.forEach((c, i) => {
            c.selected = i === this._selected;
        });
    }

    async _activateSelected() {
        if (this._cards.length === 0) {
            this.close();
            this._openPrefs();
            return;
        }
        if (this._busy)
            return;

        const card = this._cards[this._selected];
        const {cfg} = card.item;
        if (card.item.active) {
            this.close();
            return;
        }
        if (!card.item.available) {
            card.shake();
            return;
        }

        this._busy = true;
        try {
            await this._backend.activate(cfg, stage => {
                if (stage === 'connecting' && !this._closing) {
                    card.setOverride({kind: 'busy', text: 'Connecting…'});
                    this._footer.text = `Connecting to ${displayName(cfg)}…     Esc   close`;
                }
            });
            Main.osdWindowManager.showAll(
                new Gio.ThemedIcon({name: resolveIcon(cfg)}), displayName(cfg));
            this.close();
        } catch (e) {
            console.warn(`[output-device-selector] switching to ${displayName(cfg)} failed: ${e.message}`);
            if (!this._closing) {
                card.setOverride({kind: 'error', text: 'Failed'});
                card.shake();
                this._footer.text = `Could not switch: ${shortError(e)}`;
            }
        } finally {
            this._busy = false;
        }
    }

    vfunc_key_press_event(event) {
        const sym = event.get_key_symbol();
        const state = event.get_state();

        switch (sym) {
        case Clutter.KEY_Escape:
        case Clutter.KEY_q:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_d:
        case Clutter.KEY_D:
            // The opening shortcut (Super+D) toggles the popup off.
            if (state & (Clutter.ModifierType.MOD4_MASK | Clutter.ModifierType.SUPER_MASK)) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            break;
        case Clutter.KEY_Left:
        case Clutter.KEY_Up:
        case Clutter.KEY_h:
        case Clutter.KEY_k:
        case Clutter.KEY_KP_Left:
        case Clutter.KEY_KP_Up:
        case Clutter.KEY_ISO_Left_Tab:
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
        case Clutter.KEY_Down:
        case Clutter.KEY_l:
        case Clutter.KEY_j:
        case Clutter.KEY_KP_Right:
        case Clutter.KEY_KP_Down:
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            this._select(this._selected + (state & Clutter.ModifierType.SHIFT_MASK ? -1 : 1));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
            this._select(0);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._select(this._cards.length - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
        case Clutter.KEY_space:
            this._activateSelected();
            return Clutter.EVENT_STOP;
        }

        // 1..9 jump straight to a card and switch.
        if (sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9) {
            const i = sym - Clutter.KEY_1;
            if (i < this._cards.length) {
                this._select(i);
                this._activateSelected();
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_STOP;
    }

    _cardAt(event) {
        const [x, y] = event.get_coords();
        let actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        for (; actor; actor = actor.get_parent()) {
            const index = this._cards.indexOf(actor);
            if (index >= 0)
                return index;
        }
        return -1;
    }

    _insidePanel(event) {
        const [x, y] = event.get_coords();
        const [px, py] = this._panel.get_transformed_position();
        const [pw, ph] = this._panel.get_transformed_size();
        return x >= px && y >= py && x <= px + pw && y <= py + ph;
    }

    // We handle clicks here (not via St.Button) because the modal grab
    // routes every pointer event through this actor.
    vfunc_button_press_event(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY) {
            this._pressedCard = -1;
            return Clutter.EVENT_STOP;
        }
        this._pressedCard = this._cardAt(event);
        if (this._pressedCard >= 0)
            this._select(this._pressedCard);
        else if (!this._insidePanel(event))
            this.close();
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event(event) {
        const index = this._cardAt(event);
        if (index >= 0 && index === this._pressedCard) {
            this._select(index);
            this._activateSelected();
        }
        this._pressedCard = -1;
        return Clutter.EVENT_STOP;
    }
});

function shortError(e) {
    const msg = (e?.message ?? `${e}`).replace(/^GDBus\.Error:[\w.]+:\s*/, '');
    return msg.length > 70 ? `${msg.slice(0, 67)}…` : msg;
}
