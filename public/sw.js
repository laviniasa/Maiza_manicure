// Service worker: permite instalar o app e abrir a tela mesmo com internet instável.
// Os dados (agenda, clientes, caixa) sempre vêm do servidor; só os arquivos do app ficam em cache.
// Ao publicar mudanças grandes, aumente o número da versão.
const CACHE = 'studio-v5';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './js/icons.js',
  './icons/logo.svg',
  './js/data.js',
  './js/utils.js',
  './js/appointments.js',
  './js/views/inicio.js',
  './js/views/agenda.js',
  './js/views/clientes.js',
  './js/views/retornos.js',
  './js/views/caixa.js',
  './js/views/servicos.js',
  './js/views/config.js',
  './icons/icon.svg',
  './icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Rede primeiro (para receber atualizações), cache como reserva.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('./index.html'))),
  );
});
