/* Mints a short-lived, single-upload token so the browser can send the audio straight to
 * Blob storage. The file never touches this function — a serverless request body is
 * capped at 4.5 MB, and a beat is bigger than that.
 *
 * This is the endpoint that costs money if it is wrong, so it is the strictest: a token
 * is only issued to a signed-in producer, and the size ceiling and allowed content types
 * are pinned here rather than trusted from the client. */

import { handleUpload } from '@vercel/blob/client';
import { currentUser } from './_auth.js';
import { mayUpload } from './_users.js';

const MAX_BYTES = 60 * 1024 * 1024; // 60 MB — a long WAV preview, with room to spare

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const result = await handleUpload({
      body: req.body,
      request: req,

      onBeforeGenerateToken: async (pathname) => {
        const user = await currentUser(req);
        if (!user) throw new Error('Sign in first.');
        // A listener account must not be able to put files in the store's bucket.
        if (!mayUpload(user)) throw new Error('Only producers can upload beats.');

        return {
          allowedContentTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true, // two producers may upload the same filename
          pathname: `beats/${user.id}/${pathname}`,
        };
      },

      // Fires from Blob once the upload lands. The dashboard records the beat in the
      // catalogue itself, so there is nothing to do here.
      onUploadCompleted: async () => {},
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(401).json({ error: err.message ?? 'Upload rejected.' });
  }
}
