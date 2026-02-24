/**
 * Cloudflare Worker Proxy for EasyStreams Addon
 * Questo worker serve per bypassare i blocchi di Cloudflare su SuperVideo
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    // Se non c'è l'URL target, restituisci un errore semplice
    if (!targetUrl) {
      return new Response('EasyStreams Proxy Worker: Missing "url" parameter', { 
        status: 400,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    try {
      const target = new URL(targetUrl);
      
      // Crea nuovi header basandoci su quelli della richiesta originale
      const newHeaders = new Headers();
      
      // Copia gli header essenziali se presenti
      const headersToCopy = ['user-agent', 'referer', 'accept', 'accept-language', 'range'];
      for (const header of headersToCopy) {
        const value = request.headers.get(header);
        if (value) newHeaders.set(header, value);
      }

      // Forza l'Origin e l'Host per il target
      newHeaders.set('Origin', target.origin);
      
      // Esegui la richiesta al sito bloccato
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        redirect: 'follow'
      });

      // Crea una nuova risposta per poter modificare gli header CORS
      const proxyResponse = new Response(response.body, response);
      
      // Aggiungi header CORS per permettere all'addon di leggere la risposta
      proxyResponse.headers.set('Access-Control-Allow-Origin', '*');
      proxyResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      proxyResponse.headers.set('X-Proxied-By', 'EasyStreams-Worker');

      return proxyResponse;

    } catch (e) {
      return new Response(`Proxy Error: ${e.message}`, { status: 500 });
    }
  }
};
