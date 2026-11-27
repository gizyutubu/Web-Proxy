/**
 * Cloudflare Workers 用 高速Webプロキシサーバー（改良版）
 * 無料プラン（1日10万リクエストまで無料）で動作します。
 */
export default {
  async fetch(request, env, ctx) {
    // 1. CORSプリフライトリクエスト（OPTIONS）への対応
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 2. URLパラメータから転送先のターゲットURLを取得 (?url=https://...)
    const reqUrl = new URL(request.url);
    let targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
      return new Response(
        JSON.stringify({
          status: 'active',
          message: 'NexusProxy Private Worker is running! Use ?url=https://example.com',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    try {
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }

      // 3. ターゲットURLの妥当性チェック
      const parsedTarget = new URL(targetUrl);

      // 4. ターゲットサイトへリクエストを送信（ブラウザヘッダー偽装）
      const buildHeaders = (ua) => ({
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Referer': parsedTarget.origin + '/',
      });

      let proxyResponse = await fetch(parsedTarget.toString(), {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: buildHeaders(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
        ),
        redirect: 'follow',
      });

      // 4-2. 対象サイトから 429 / 403 が返った場合、モバイルUAで再試行し、それでもダメならJina Reader経由で抽出
      if (proxyResponse.status === 429 || proxyResponse.status === 403) {
        proxyResponse = await fetch(parsedTarget.toString(), {
          method: 'GET',
          headers: buildHeaders(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
          ),
          redirect: 'follow',
        });
      }

      if (proxyResponse.status === 429 || proxyResponse.status === 403) {
        const jinaRes = await fetch(`https://r.jina.ai/${parsedTarget.toString()}`, {
          headers: { 'Accept': 'text/plain; charset=utf-8' },
        });
        if (jinaRes.ok) {
          const md = await jinaRes.text();
          const escaped = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const fallbackHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:820px;margin:1.5rem auto;padding:1.25rem;line-height:1.75;background:#0f172a;color:#f1f5f9;white-space:pre-wrap;word-break:break-word;}</style></head><body><div style="background:#1e293b;border:1px solid #334155;padding:0.75rem 1rem;border-radius:0.75rem;margin-bottom:1.25rem;font-size:12px;color:#fbbf24;">⚠️ 対象サイトがCloudflare IPを制限(HTTP 429/403)したため、Worker内フォールバック(Jina Reader)で抽出表示しています。</div>${escaped}</body></html>`;
          return new Response(fallbackHtml, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }

      // 5. レスポンスヘッダーの構築（CORS許可・フレーム制限解除・圧縮不整合の防止）
      const newHeaders = new Headers(proxyResponse.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', '*');
      newHeaders.delete('X-Frame-Options');
      newHeaders.delete('Content-Security-Policy');
      newHeaders.delete('Content-Security-Policy-Report-Only');
      newHeaders.delete('Clear-Site-Data');
      newHeaders.delete('Content-Encoding');
      newHeaders.delete('Content-Length');

      // 6. 取得したデータをブラウザへ返却
      return new Response(proxyResponse.body, {
        status: proxyResponse.status,
        statusText: proxyResponse.statusText,
        headers: newHeaders,
      });
    } catch (error) {
      return new Response(`Proxy Error: ${error.message}`, {
        status: 502,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};