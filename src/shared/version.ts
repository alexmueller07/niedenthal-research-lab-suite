// The app's name as the lab sees it: "Niedenthal Lab Suite v1.5.0".
//
// Randy, 2026-10-13: put the version at the end of the app name, so an RA can
// say which build a machine is running without opening anything. The installed
// name (productName in tauri.conf.json) deliberately stays version-free —
// changing it moves the install folder and breaks upgrading in place.

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;

export const APP_NAME = `Niedenthal Lab Suite v${APP_VERSION}`;
