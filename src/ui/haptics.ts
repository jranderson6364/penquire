import { nativeApiVersion } from '../../modules/pencil-canvas';

/** Light haptics (expo-haptics is in native build 3+; a no-op before). Loaded lazily so older binaries never fail. */
type HapticsLib = typeof import('expo-haptics');
let lib: HapticsLib | null | undefined;

function haptics(): HapticsLib | null {
  if (lib === undefined) {
    lib = null;
    if (nativeApiVersion >= 3) {
      try {
        lib = require('expo-haptics') as HapticsLib;
      } catch {
        lib = null;
      }
    }
  }
  return lib;
}

/** A selection tick: something on the page answered your tap. */
export function tick() {
  const h = haptics();
  if (h) void h.selectionAsync().catch(() => undefined);
}

/** A check finished. */
export function done() {
  const h = haptics();
  if (h) void h.notificationAsync(h.NotificationFeedbackType.Success).catch(() => undefined);
}
