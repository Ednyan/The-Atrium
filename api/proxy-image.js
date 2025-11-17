// Cloudflare Workers Image Proxy
// Proxies images to bypass CORS restrictions

export default {
  async fetch(request) {
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
      const contentType = response.headers.get('content-type') || 'image/png'

      // Return with CORS headers
      return new Response(imageData, {
        headers: {
          'Content-Type': contentType,
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
}

