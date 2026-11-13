import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AudioBackend} from './lib/audio.js';
import {SelectorPopup} from './lib/popup.js';

export default class OutputDeviceSelectorExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._backend = new AudioBackend(this._settings);
        this._popup = null;

        Main.wm.addKeybinding('toggle-popup', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this.toggle());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-popup');
        this._popup?.destroy();
        this._popup = null;
        this._backend?.destroy();
        this._backend = null;
        this._settings = null;
    }

    toggle() {
        if (this._popup) {
            this._popup.close();
            return;
        }

        // Close an open shell menu (we may be called in POPUP mode).
        Main.panel.menuManager.activeMenu?.close();

        const popup = new SelectorPopup(this._backend, {
            openPrefs: () => this.openPreferences(),
        });
        popup.connect('destroy', () => {
            if (this._popup === popup)
                this._popup = null;
        });
        this._popup = popup;
        if (!popup.open())
            this._popup = null;
    }
}
