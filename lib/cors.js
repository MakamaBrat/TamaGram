// lib/cors.js
//
// Vercel serverless-функции по умолчанию НЕ добавляют CORS-заголовки.
// Если Unity WebGL хостится на другом домене, чем /api (например, игра
// на static-хостинге, а бот+api отдельно на Vercel), браузер молча
// блокирует запрос ещё до того, как он доходит до сервера.
//
// Подключается в начале каждого handler'а.

export function applyCors(req, res) {
  // Если игра и API на ОДНОМ домене — можно указать конкретный домен
  // вместо '*' для большей безопасности. Пока ставим '*' для простоты
  // отладки.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Браузер перед реальным запросом шлёт preflight OPTIONS —
  // на него нужно ответить 200 и завершить обработку.
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // сигнал вызывающему коду, что нужно остановиться
  }

  return false;
}
