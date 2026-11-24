import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    srcDir: 'src',
    publicDir: resolve(rootDir, 'public'),
    modules: ['@wxt-dev/module-react'],
    manifest: () => ({
        name: 'Link Map',
        version: '2.0.0',
        description: '__MSG_extDesc__',
        default_locale: 'en',
        minimum_chrome_version: '116',
        permissions: [
            'tabs',
            'tabGroups',
            'windows',
            'sidePanel',
            'storage',
            'downloads',
            'system.display',
            'favicon',
        ],
        // Only requested dynamically when the user disables Simple Offline Mode
        // and configures a cloud sync provider or AI endpoint.
        optional_host_permissions: ['https://*/*', 'http://*/*'],
        icons: {
            16: 'icons/x16.png',
            32: 'icons/x32.png',
            48: 'icons/x48.png',
            128: 'icons/x128.png',
        },
        action: {
            default_title: 'Link Map',
            default_icon: {
                16: 'icons/x16.png',
                32: 'icons/x32.png',
                48: 'icons/x48.png',
                128: 'icons/x128.png',
            },
        },
        commands: {
            openLinkMap: {
                suggested_key: {
                    default: 'Ctrl+Shift+L',
                    mac: 'Command+Shift+L',
                },
                description: '__MSG_commandTriggerLinkMap__',
            },
        },
        web_accessible_resources: [
            {
                matches: ['<all_urls>'],
                resources: ['icons/*'],
            },
        ],
    }),
});
