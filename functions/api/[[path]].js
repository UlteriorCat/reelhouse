// Cloudflare Pages Function: handles every /api/* request. All logic lives in lib/ so it can be unit-tested in Node.
import { handleApi } from '../../lib/api.js';

export const onRequest = (context) => handleApi(context.request, context.env);
