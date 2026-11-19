// Shared singletons: the transport (reads settings lazily so changes apply immediately) and browser capabilities.
import { store } from './store.js';
import { createNet } from './net.js';
import { browserCaps } from './streams.js';

let capsCache;
export const caps = () => (capsCache ||= browserCaps());
export const net = createNet(() => store.settings(), undefined, { nativeHls: () => caps().nativeHls });
