import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

function createWorker() {
  const listeners = new Map();
  const cachedPage = new Response('<!doctype html><title>Encontro</title>', {
    headers: { 'Content-Type': 'text/html' }
  });
  const cache = { addAll: async () => {}, put: async () => {} };
  const caches = {
    open: async () => cache,
    keys: async () => ['encontro-pwa-v6'],
    delete: async () => true,
    match: async request => request === './index.html' ? cachedPage : null
  };
  const self = {
    location: { origin: 'https://app.test' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (name, callback) => listeners.set(name, callback)
  };

  vm.runInNewContext(workerSource, {
    self,
    caches,
    URL,
    Response,
    Promise,
    fetch: async () => { throw new TypeError('offline'); }
  });
  return { fetchHandler: listeners.get('fetch'), cachedPage };
}

function dispatchFetch(fetchHandler, request) {
  let responsePromise;
  fetchHandler({ request, respondWith: response => { responsePromise = response; } });
  return responsePromise;
}

test('uses the cached page only as an offline navigation fallback', async () => {
  const { fetchHandler, cachedPage } = createWorker();
  const response = await dispatchFetch(fetchHandler, {
    url: 'https://app.test/inscricao',
    method: 'GET',
    mode: 'navigate'
  });

  assert.equal(response, cachedPage);
});

test('does not return HTML when an uncached asset fails offline', async () => {
  const { fetchHandler } = createWorker();
  const response = await dispatchFetch(fetchHandler, {
    url: 'https://app.test/app.js',
    method: 'GET',
    mode: 'same-origin'
  });

  assert.equal(response.type, 'error');
});

test('leaves API requests outside the service worker cache strategy', () => {
  const { fetchHandler } = createWorker();
  const responsePromise = dispatchFetch(fetchHandler, {
    url: 'https://app.test/api/event',
    method: 'GET',
    mode: 'cors'
  });

  assert.equal(responsePromise, undefined);
});
