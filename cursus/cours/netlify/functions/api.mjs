import { createApi } from '../../lib/core.mjs';
import { blobsStorage } from '../../lib/storage-blobs.mjs';
import { asNetlifyHandler } from '../../lib/netlify.mjs';

export default asNetlifyHandler(createApi(blobsStorage()));

export const config = { path: '/api/*' };
