const http = require('http');
const { URL } = require('url');

// Simple web server to handle website analysis requests. The server exposes
// two routes:
//   GET /            – serves the static HTML page from the `public` folder.
//   GET /analyze?url – fetches the given URL, extracts SEO‐relevant data and
//                      returns it as JSON. This endpoint is intentionally
//                      designed to be lightweight and easy to extend in
//                      future iterations (for example, adding API access or
//                      additional metrics).

// Helper: read a file from the filesystem. Used to serve static assets.
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');

/**
 * Extract the contents of a specific tag (e.g. <title>). Only the first
 * occurrence is returned. Tags are matched case‑insensitively.
 *
 * @param {string} html The HTML source to search.
 * @param {string} tagName The tag name to extract.
 * @returns {string} The trimmed inner text, or an empty string if not found.
 */
function getTagContent(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\s\S]*?)<\\/${tagName}>`, 'i');
  const match = html.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Extract the value of a <meta> tag with a given name attribute.
 *
 * @param {string} html The HTML source to search.
 * @param {string} name The value of the name attribute to match (e.g. "description").
 * @returns {string} The content attribute value, or an empty string if not found.
 */
function getMetaContent(html, key) {
  // name attribute
  let regex = new RegExp(`<meta[^>]*name=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  let match = html.match(regex);
  if (match) return match[1];
  // property attribute
  regex = new RegExp(`<meta[^>]*property=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  match = html.match(regex);
  return match ? match[1] : '';
}

/**
 * Count the words contained within all <p> tags in the given HTML. The
 * algorithm strips nested tags and counts whitespace-separated tokens.
 *
 * @param {string} html The HTML source to search.
 * @returns {number} The total number of words found within <p> tags.
 */
function countWordsInPTags(html) {
  const regex = /<p[^>]*>(.*?)<\/?p>/gi;
  let match;
  let wordCount = 0;
  while ((match = regex.exec(html)) !== null) {
    // Remove HTML tags from the paragraph content
    const text = match[1].replace(/<[^>]+>/g, ' ');
    // Split on whitespace and filter out empty strings
    const words = text.trim().split(/\s+/).filter(Boolean);
    wordCount += words.length;
  }
  return wordCount;
}

// helper to get the document title with fallbacks
function getDocumentTitle(html) {
  const titleTag = getTagContent(html, 'title');
  if (titleTag) return titleTag;
  const ogTitle = getMetaContent(html, 'og:title');
  if (ogTitle) return ogTitle;
  return getMetaContent(html, 'title');
}

// in handleAnalysis:
const title = getDocumentTitle(html);
const metaDescription = getMetaContent(html, 'description');

/**
 * Handle an analysis request. Fetches the remote page, extracts data and
 * responds with JSON.
 *
 * @param {string} targetUrl A fully qualified URL to fetch.
 * @param {function} respond A callback to send the JSON response.
 */
async function handleAnalysis(targetUrl, respond) {
  try {
    // Ensure the URL uses http or https
    const parsedUrl = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      respond({ error: 'Invalid protocol; only http and https are supported.' });
      return;
    }

    // Fetch the remote page. We follow redirects by default.
    const response = await fetch(targetUrl);

    // Read the response body as text for parsing
    const html = await response.text();

    // Extract meta information
    const title = getTagContent(html, 'title');
    const metaDescription = getMetaContent(html, 'description');

    const analysis = {
      statusCode: response.status,
      metaTitle: title,
      metaTitleLength: title.length,
      metaDescription: metaDescription,
      metaDescriptionLength: metaDescription.length,
      wordCountInPTags: countWordsInPTags(html),
    };
    respond(analysis);
  } catch (err) {
    respond({ error: err.message || 'Failed to fetch or process the URL.' });
  }
}

// Create a simple HTTP server. Note: Using Node's core http module avoids
// external dependencies and keeps the tool self-contained.
const server = http.createServer(async (req, res) => {
  // Basic routing: serve static files or handle /analyze endpoint
  const { method, url: reqUrl } = req;
  const parsed = new URL(reqUrl, `http://${req.headers.host}`);

  if (method === 'GET' && parsed.pathname === '/analyze') {
    const target = parsed.searchParams.get('url');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter.' }));
      return;
    }
    handleAnalysis(target, data => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
    return;
  }

  // Serve static assets from the public directory (index.html, CSS, JS)
  let filePath = path.join(publicDir, parsed.pathname.replace(/^\/+/, ''));
  // If no specific file is requested, serve index.html
  if (parsed.pathname === '/' || parsed.pathname === '') {
    filePath = path.join(publicDir, 'index.html');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    // Determine content type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

// Start the server on port 3000 if this file is executed directly.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Website analyzer server is running on http://localhost:${port}`);
  });
}

module.exports = { server };
