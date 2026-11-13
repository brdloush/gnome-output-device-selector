// Small BlueZ (system D-Bus) helper. Shared by the extension and the preferences.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BLUEZ = 'org.bluez';
const DEVICE_IFACE = 'org.bluez.Device1';
const ADAPTER_IFACE = 'org.bluez.Adapter1';

// Service UUIDs of devices that can play audio.
const AUDIO_SINK_UUIDS = [
    '0000110b-0000-1000-8000-00805f9b34fb', // A2DP sink
    '0000111e-0000-1000-8000-00805f9b34fb', // Handsfree
    '00001108-0000-1000-8000-00805f9b34fb', // Headset
    '00001850-0000-1000-8000-00805f9b34fb', // LE Audio: Published Audio Capabilities
];

function dbusCall(path, iface, method, params, timeoutMs = -1) {
    return new Promise((resolve, reject) => {
        Gio.DBus.system.call(BLUEZ, path, iface, method, params, null,
            Gio.DBusCallFlags.NONE, timeoutMs, null, (bus, res) => {
                try {
                    resolve(bus.call_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function delay(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Paired Bluetooth devices that can play audio.
 * @returns {Promise<Array<{path, address, name, icon, connected, adapterPowered}>>}
 */
export async function listAudioDevices() {
    let objects;
    try {
        const reply = await dbusCall('/', 'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects', null);
        [objects] = reply.recursiveUnpack();
    } catch (e) {
        // BlueZ is not running, or no adapter.
        return [];
    }

    const result = [];
    for (const [path, ifaces] of Object.entries(objects)) {
        const dev = ifaces[DEVICE_IFACE];
        if (!dev || !dev.Paired)
            continue;

        const uuids = (dev.UUIDs ?? []).map(u => u.toLowerCase());
        const icon = dev.Icon ?? '';
        const isAudio = icon.startsWith('audio-') ||
            uuids.some(u => AUDIO_SINK_UUIDS.includes(u));
        if (!isAudio)
            continue;

        const adapterPath = dev.Adapter ?? path.substring(0, path.lastIndexOf('/'));
        result.push({
            path,
            address: (dev.Address ?? '').toUpperCase(),
            name: dev.Alias || dev.Name || dev.Address,
            icon,
            connected: !!dev.Connected,
            adapterPowered: !!objects[adapterPath]?.[ADAPTER_IFACE]?.Powered,
        });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

async function powerOnAdapter(devicePath) {
    const adapterPath = devicePath.substring(0, devicePath.lastIndexOf('/'));
    await dbusCall(adapterPath, 'org.freedesktop.DBus.Properties', 'Set',
        new GLib.Variant('(ssv)', [ADAPTER_IFACE, 'Powered', new GLib.Variant('b', true)]));
    // Give the adapter a moment to come up.
    await delay(1500);
}

/** Connect a paired device. Powers on the adapter when needed. */
export async function connectDevice(device) {
    if (!device.adapterPowered)
        await powerOnAdapter(device.path);

    for (let attempt = 0; ; attempt++) {
        try {
            await dbusCall(device.path, DEVICE_IFACE, 'Connect', null, 30000);
            return;
        } catch (e) {
            const msg = e.message ?? '';
            if (/AlreadyConnected/i.test(msg))
                return;
            if (attempt >= 2)
                throw e;
            if (/NotReady|powered/i.test(msg))
                await powerOnAdapter(device.path);
            else if (/InProgress|busy|br-connection-(page-timeout|create-socket|unknown)/i.test(msg))
                await delay(1500);
            else
                throw e;
        }
    }
}

/**
 * Call `callback` when a BlueZ device property that matters to us changes.
 * Returns an unsubscribe function.
 */
export function watchDevices(callback) {
    const bus = Gio.DBus.system;
    const ids = [
        bus.signal_subscribe(BLUEZ, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            null, null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [iface, changed] = params.deepUnpack();
                if (iface === ADAPTER_IFACE ||
                    (iface === DEVICE_IFACE &&
                     ['Connected', 'Paired', 'Alias', 'Name', 'Icon', 'UUIDs'].some(k => k in changed)))
                    callback();
            }),
        bus.signal_subscribe(BLUEZ, 'org.freedesktop.DBus.ObjectManager', 'InterfacesAdded',
            null, null, Gio.DBusSignalFlags.NONE, () => callback()),
        bus.signal_subscribe(BLUEZ, 'org.freedesktop.DBus.ObjectManager', 'InterfacesRemoved',
            null, null, Gio.DBusSignalFlags.NONE, () => callback()),
    ];
    return () => ids.forEach(id => bus.signal_unsubscribe(id));
}
