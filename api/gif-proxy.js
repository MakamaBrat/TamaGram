// api/gif-proxy.js
// Прокси для обхода CORS при загрузке гифок с внешних доменов (например, gifer.com).
// Деплоится автоматически на Vercel как serverless-функция.
//
// Использование в Unity (WebGL):
//   вместо https://i.gifer.com/162Y.gif
//   указывай https://tama-gram.vercel.app/api/gif-proxy?url=https://i.gifer.com/162Y.gif

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    res.status(400).json({ error: 'Missing "url" query parameter' });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch (e) {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  // На всякий случай разрешаем только http/https, чтобы прокси нельзя было
  // использовать для чтения file:// или других схем.
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    res.status(400).json({ error: 'Only http/https URLs are allowed' });
    return;
  }

  try {
    const upstreamResponse = await fetch(targetUrl.toString());

    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status).json({
        error: `Upstream request failed: ${upstreamResponse.status} ${upstreamResponse.statusText}`,
      });
      return;
    }

    const contentType = upstreamResponse.headers.get('content-type') || 'image/gif';
    const arrayBuffer = await upstreamResponse.arrayBuffer();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', contentType);
    // Кэшируем на CDN Vercel на сутки, чтобы не дёргать gifer.com при каждом запуске сцены
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');

    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(500).json({ error: `Proxy fetch failed: ${error.message}` });
  }
}
