// Shared singletons: the transport (reads settings lazily so changes apply immediately) and browser capabilities.
import { store } from './store.js';
import { createNet } from './net.js';
import { browserCaps } from './streams.js';

export const net = createNet(() => store.settings());
let capsCache;
export const caps = () => (capsCache ||= browserCaps());
