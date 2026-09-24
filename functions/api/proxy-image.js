// Cloudflare Pages Function
// Path: /api/proxy-image
// Proxies images to bypass CORS restrictions

export async function onRequest(context) {
  const { request } = context

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  // Get the image URL from query parameter
  const url = new URL(request.url)
  const imageUrl = url.searchParams.get('url')

  if (!imageUrl) {
    return new Response('Missing url parameter', { 
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    })
  }

  try {
    // Fetch the image
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.google.com/',
      }
    })

    if (!response.ok) {
      return new Response('Failed to fetch image', { 
        status: response.status,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      })
    }

    // Get the image data
    const imageData = await response.arrayBuffer()
    const upstreamType = response.headers.get('content-type') || ''

    // This answers from the site's own origin, so whatever it passes on is
    // treated as the Atrium's own. An HTML page fetched through it used to be
    // served as HTML -- a script in it ran as the site, with the signed-in
    // session in reach, and one link to it was enough. Images keep their
    // type; anything else goes out as bytes to download, which an <img> still
    // decodes when it really is a picture behind a vague type.
    const isImage = /^image\//i.test(upstreamType)
    const contentType = isImage ? upstreamType : 'application/octet-stream'

    // Return with CORS headers
    return new Response(imageData, {
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        // An SVG is an image that can carry script. Inside an <img> it never
        // runs; opened directly, this keeps it from running there either.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        ...(isImage ? {} : { 'Content-Disposition': 'attachment' }),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      }
    })
  } catch (error) {
    return new Response('Error fetching image: ' + error.message, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    })
  }
}
