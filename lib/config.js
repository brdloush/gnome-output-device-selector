// Shared between the shell extension and the preferences window.
// Only plain JS here: no Shell, St, Gtk or Adw imports.

/**
 * A configured device, stored as JSON in the `devices` key:
 *
 *   { key, type: 'port' | 'bluetooth', name, alias, icon,
 *     origin, port,          // type === 'port'      (card description + port name)
 *     address, deviceIcon }  // type === 'bluetooth' (BlueZ MAC address + BlueZ icon)
 */

export const ICON_CHOICES = [
    {id: 'auto', label: 'Automatic'},
    {id: 'audio-speakers-symbolic', label: 'Speakers'},
    {id: 'audio-headphones-symbolic', label: 'Headphones'},
    {id: 'audio-headset-symbolic', label: 'Headset'},
    {id: 'video-display-symbolic', label: 'Monitor'},
    {id: 'tv-symbolic', label: 'TV'},
    {id: 'audio-card-symbolic', label: 'Sound card'},
    {id: 'bluetooth-active-symbolic', label: 'Bluetooth'},
];

export function portKey(origin, port) {
    return `port:${origin}|${port}`;
}

export function btKey(address) {
    return `bt:${address.toUpperCase()}`;
}

function parseArray(text) {
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

export function loadDevices(settings) {
    return parseArray(settings.get_string('devices'))
        .filter(d => d && typeof d.key === 'string' && (d.type === 'port' || d.type === 'bluetooth'));
}

export function saveDevices(settings, devices) {
    settings.set_string('devices', JSON.stringify(devices));
}

export function loadKnownPorts(settings) {
    return parseArray(settings.get_string('known-ports'))
        .filter(p => p && typeof p.origin === 'string' && typeof p.port === 'string');
}

export function displayName(device) {
    const alias = (device.alias ?? '').trim();
    return alias || device.name || device.key;
}

/** Pick a nice symbolic icon when the user left the icon on "Automatic". */
export function resolveIcon(device) {
    if (device.icon && device.icon !== 'auto')
        return device.icon;

    if (device.type === 'bluetooth') {
        const icon = device.deviceIcon ?? '';
        if (icon.includes('headset'))
            return 'audio-headset-symbolic';
        if (icon.includes('headphone'))
            return 'audio-headphones-symbolic';
        return 'audio-speakers-symbolic';
    }

    const port = `${device.port ?? ''} ${device.name ?? ''}`.toLowerCase();
    if (port.includes('hdmi') || port.includes('displayport') || port.includes('iec958'))
        return 'video-display-symbolic';
    if (port.includes('headset'))
        return 'audio-headset-symbolic';
    if (port.includes('headphone'))
        return 'audio-headphones-symbolic';
    if (port.includes('speaker') || port.includes('lineout') || port.includes('line-out'))
        return 'audio-speakers-symbolic';
    return 'audio-card-symbolic';
}
