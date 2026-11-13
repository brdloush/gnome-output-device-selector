// Audio side of the extension: PipeWire/PulseAudio outputs (via Gvc, the same
// library GNOME's sound menu uses) plus BlueZ connection state.
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';

import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import * as BlueZ from './bluez.js';
import {loadDevices, loadKnownPorts, portKey} from './config.js';
import {typeName} from './gtype.js';

const SCAN_MIN_IDS = 256;
const BT_CONNECT_TIMEOUT_MS = 20000;
const HANDSFREE_RE = /(-hf-|handsfree|hands-free|headset-head-unit|hsp|hfp)/i;

export const AudioBackend = GObject.registerClass({
    GTypeName: typeName('AudioBackend'),
    Signals: {'changed': {}},
}, class AudioBackend extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._control = Volume.getMixerControl();
        this._maxId = 0;
        this._bt = new Map(); // address -> BlueZ device
        this._sources = new Set();
        this._changedId = 0;
        this._btRefreshId = 0;
        this._destroyed = false;

        this._control.connectObject(
            'output-added', (_c, id) => {
                this._maxId = Math.max(this._maxId, id);
                this._queueChanged();
            },
            'output-removed', () => this._queueChanged(),
            'active-output-update', () => this._queueChanged(),
            'default-sink-changed', () => this._queueChanged(),
            'state-changed', () => this._queueChanged(),
            this);

        this._unwatchBt = BlueZ.watchDevices(() => this._queueBtRefresh());
        this.refreshBluetooth();
        this._queueChanged();
    }

    destroy() {
        this._destroyed = true;
        this._control.disconnectObject(this);
        this._unwatchBt?.();
        this._unwatchBt = null;
        for (const id of this._sources)
            GLib.source_remove(id);
        this._sources.clear();
    }

    _timeout(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._sources.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
        return id;
    }

    _sleep(ms) {
        return new Promise(resolve => this._timeout(ms, resolve));
    }

    _queueChanged() {
        if (this._changedId)
            return;
        this._changedId = this._timeout(100, () => {
            this._changedId = 0;
            this._publishKnownPorts();
            this.emit('changed');
        });
    }

    _queueBtRefresh() {
        if (this._btRefreshId)
            return;
        this._btRefreshId = this._timeout(250, () => {
            this._btRefreshId = 0;
            this.refreshBluetooth();
        });
    }

    async refreshBluetooth() {
        const devices = await BlueZ.listAudioDevices();
        if (this._destroyed)
            return;
        this._bt = new Map(devices.map(d => [d.address, d]));
        this._queueChanged();
    }

    // ---- Gvc outputs -------------------------------------------------------

    get ready() {
        return this._control.get_state() === Gvc.MixerControlState.READY;
    }

    /** All output "UI devices" Gvc knows, including unplugged ports. */
    _outputs() {
        if (!this.ready)
            return [];
        // Gvc has no "list outputs" call; ids are small increasing integers.
        const limit = Math.max(SCAN_MIN_IDS, this._maxId + 64);
        const outputs = [];
        for (let id = 1; id <= limit; id++) {
            const dev = this._control.lookup_output_id(id);
            if (!dev)
                continue;
            this._maxId = Math.max(this._maxId, id);
            const streamId = dev.get_stream_id();
            const stream = streamId ? this._control.lookup_stream_id(streamId) : null;
            outputs.push({
                id,
                dev,
                origin: dev.get_origin() ?? '',
                port: dev.get_port() ?? '',
                description: dev.get_description() ?? '',
                icon: dev.get_icon_name() ?? '',
                available: !!dev.port_available,
                streamName: stream?.get_name() ?? '',
            });
        }
        return outputs;
    }

    _activeOutputId() {
        const sink = this._control.get_default_sink();
        if (!sink)
            return -1;
        return this._control.lookup_device_from_stream(sink)?.get_id() ?? -1;
    }

    _isBluetoothOutput(out) {
        if (out.icon.includes('bluetooth') || out.streamName.startsWith('bluez'))
            return true;
        for (const bt of this._bt.values()) {
            if (bt.name === out.origin)
                return true;
        }
        return false;
    }

    _btOutputs(outputs, cfg) {
        const bt = this._bt.get(cfg.address);
        const addrUnderscore = cfg.address.replaceAll(':', '_');
        const names = new Set([bt?.name, cfg.name].filter(Boolean));
        return outputs.filter(o =>
            o.available &&
            (o.streamName.toUpperCase().includes(cfg.address) ||
             o.streamName.toUpperCase().includes(addrUnderscore) ||
             names.has(o.origin)));
    }

    /** The output to switch to for a Bluetooth device: prefer hi-fi (A2DP) over handsfree. */
    _bestBtOutput(outputs, cfg) {
        const candidates = this._btOutputs(outputs, cfg);
        return candidates.find(o => !HANDSFREE_RE.test(o.port)) ?? candidates[0] ?? null;
    }

    _publishKnownPorts() {
        const outputs = this._outputs();
        if (outputs.length === 0)
            return;

        const known = new Map(loadKnownPorts(this._settings).map(p => [portKey(p.origin, p.port), p]));
        let changed = false;
        for (const out of outputs) {
            if (this._isBluetoothOutput(out))
                continue;
            const key = portKey(out.origin, out.port);
            const old = known.get(key);
            if (old && old.description === out.description && old.icon === out.icon)
                continue;
            known.set(key, {origin: out.origin, port: out.port, description: out.description, icon: out.icon});
            changed = true;
        }
        if (changed)
            this._settings.set_string('known-ports', JSON.stringify([...known.values()]));
    }

    // ---- Public API --------------------------------------------------------

    /**
     * Current state of every configured device, in the configured order.
     * state: 'active' | 'available' | 'unavailable' | 'connected' | 'disconnected'
     */
    getItems() {
        const outputs = this._outputs();
        const activeId = this._activeOutputId();

        return loadDevices(this._settings).map(cfg => {
            if (cfg.type === 'bluetooth') {
                const bt = this._bt.get(cfg.address);
                const outs = this._btOutputs(outputs, cfg);
                const connected = bt ? bt.connected : outs.length > 0;
                return {
                    cfg,
                    hasConnection: true,
                    connected,
                    known: !!bt,
                    active: outs.some(o => o.id === activeId),
                    available: !!bt || outs.length > 0,
                };
            }

            const out = outputs.find(o => o.origin === cfg.origin && o.port === cfg.port);
            return {
                cfg,
                hasConnection: false,
                connected: false,
                known: !!out,
                active: !!out && out.id === activeId,
                available: !!out && out.available,
            };
        });
    }

    /**
     * Make `cfg` the default output. Connects Bluetooth devices first.
     * @param {object} cfg configured device
     * @param {Function} onProgress called with 'connecting' before a Bluetooth connect
     */
    async activate(cfg, onProgress = () => {}) {
        if (cfg.type === 'bluetooth')
            return this._activateBluetooth(cfg, onProgress);

        const out = this._outputs().find(o => o.origin === cfg.origin && o.port === cfg.port);
        if (!out)
            throw new Error('Device not found');
        if (!out.available)
            throw new Error('Device is unplugged');
        this._control.change_output(out.dev);
    }

    async _activateBluetooth(cfg, onProgress) {
        let out = this._bestBtOutput(this._outputs(), cfg);

        if (!out) {
            await this.refreshBluetooth();
            const bt = this._bt.get(cfg.address);
            if (!bt)
                throw new Error('Bluetooth device is not paired');
            if (!bt.connected) {
                onProgress('connecting');
                await BlueZ.connectDevice(bt);
            }

            // Wait until PipeWire exposes the device as an output.
            const deadline = GLib.get_monotonic_time() + BT_CONNECT_TIMEOUT_MS * 1000;
            while (!(out = this._bestBtOutput(this._outputs(), cfg))) {
                if (this._destroyed)
                    return;
                if (GLib.get_monotonic_time() > deadline)
                    throw new Error('Connected, but no audio output appeared');
                await this._sleep(200);
            }
            // PipeWire may still be settling the profile; give it a moment.
            await this._sleep(300);
            out = this._bestBtOutput(this._outputs(), cfg) ?? out;
        }

        if (!this._destroyed)
            this._control.change_output(out.dev);
    }
});
