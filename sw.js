// Contraluz: guarda la aplicación para abrirla sin conexión y sirve las teselas de las zonas descargadas
const CACHE = "contraluz-v6";
const SHELL = ["./", "./index.html", "./manifest.webmanifest"];
const T_CACHE = "contraluz-off-tiles", F_CACHE = "contraluz-off-fonts";
const RX_TILE = /^https:\/\/(server\.arcgisonline\.com\/ArcGIS\/rest\/services\/(World_Topo_Map|World_Imagery)\/MapServer\/tile\/|tiles\.mapterhorn\.com\/|s3\.amazonaws\.com\/elevation-tiles-prod\/|djlorenz\.github\.io\/astronomy\/(image_tiles|binary_tiles)\/)/;
const RX_ESRI = /arcgisonline\.com\/ArcGIS\/rest\/services\/(World_Topo_Map|World_Imagery)\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/;
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && !k.startsWith("contraluz-off")).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// mapa sin la tesela exacta: se amplía la de un zoom inferior ya descargada (borrosa pero útil)
async function overzoom(url) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const m = url.match(RX_ESRI); if (!m) return null;
  const z = +m[2], y = +m[3], x = +m[4], base = url.slice(0, url.indexOf("/tile/") + 6);
  for (let dz = 1; dz <= 4 && z - dz >= 0; dz++) {
    const pz = z - dz, px = x >> dz, py = y >> dz, r = await caches.match(`${base}${pz}/${py}/${px}`, { cacheName: T_CACHE }); if (!r) continue;
    try {
      const bmp = await createImageBitmap(await r.blob()), n = bmp.width, sub = n / 2 ** dz, c = new OffscreenCanvas(n, n), ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, (x - (px << dz)) * sub, (y - (py << dz)) * sub, sub, sub, 0, 0, n, n);
      return new Response(await c.convertToBlob({ type: "image/jpeg", quality: .85 }), { headers: { "Content-Type": "image/jpeg" } });
    } catch (e) { return null; }
  }
  return null;
}
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = e.request.url, u = new URL(url);
  if (RX_TILE.test(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(url, { cacheName: T_CACHE }); if (hit) return hit;
      try { return await fetch(e.request); }
      catch (err) { const oz = await overzoom(url); if (oz) return oz; return new Response("", { status: 504, statusText: "Sin conexión" }); }
    })());
    return;
  }
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.open(F_CACHE).then(async c => { const hit = await c.match(e.request); const net = fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (u.origin !== location.origin) return; // el resto de datos externos los gestiona la propia página
  // la página, primero de la red (para recibir actualizaciones) y si no hay conexión, de la caché
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
