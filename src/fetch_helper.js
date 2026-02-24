
const FETCH_TIMEOUT = 15000; // 15 seconds

let originalFetch = global.fetch;

// Polyfill if needed
if (!originalFetch) {
    try {
        const nodeFetch = require('node-fetch');
        originalFetch = nodeFetch;
        global.fetch = nodeFetch;
        global.Headers = nodeFetch.Headers;
        global.Request = nodeFetch.Request;
        global.Response = nodeFetch.Response;
    } catch (e) {
        console.warn("No fetch implementation found and node-fetch is not available!");
    }
}

const fetchWithTimeout = async function(url, options = {}) {
    // If a signal is already provided, respect it
    if (options.signal) {
        return originalFetch(url, options);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, options.timeout || FETCH_TIMEOUT);

    try {
        const response = await originalFetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request to ${url} timed out after ${options.timeout || FETCH_TIMEOUT}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
};

// Override global fetch so it applies to all calls
global.fetch = fetchWithTimeout;

module.exports = { fetchWithTimeout };
