/* Mints a short-lived, single-upload token so the browser can send the audio file
 * straight to Blob storage. The file never touches this function — a serverless
 * request body is capped at 4.5 MB, and a beat is bigger than that.
 *
 * The token is only issued to a signed-in admin, so this is not an open upload
 * endpoint: onBeforeGenerateToken throws for anyone else, and the size and content
 * types are pinned here rather than trusted from the client. */

import { handleUpload } from '@vercel/blob/client';
import { isAuthed } from './_auth.js';

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
        if (!isAuthed(req)) throw new Error('Not signed in.');

        return {
          allowedContentTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true, // two beats may share a filename
          pathname: `beats/${pathname}`,
        };
      },

      // Fires from Blob after the upload lands. The admin page records the beat in the
      // catalogue itself, so there is nothing to do here.
      onUploadCompleted: async () => {},
    });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(401).json({ error: err.message ?? 'Upload rejected.' });
  }
}
