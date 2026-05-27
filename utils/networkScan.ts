import * as Network from "expo-network";

export interface ScanResult {
  url: string;
  ip: string;
  port: number;
  latencyMs: number;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  subnet: string;
  found: ScanResult[];
}

const SUFFIX = "/terrabreed";
const TIMEOUT_MS = 2500;

/**
 * Tentukan protokol dan format URL berdasarkan port:
 *   80   → http://IP/terrabreed          (Nginx HTTP default, tanpa port eksplisit)
 *   443  → https://IP/terrabreed         (Nginx HTTPS default, tanpa port eksplisit)
 *   lain → http://IP:PORT/terrabreed     (Flask langsung / dev server)
 */
export function buildScanUrl(ip: string, port: number): { testUrl: string; baseUrl: string } {
  if (port === 80) {
    return {
      testUrl: `http://${ip}${SUFFIX}/api/sensor/latest`,
      baseUrl: `http://${ip}${SUFFIX}`,
    };
  }
  if (port === 443) {
    return {
      testUrl: `https://${ip}${SUFFIX}/api/sensor/latest`,
      baseUrl: `https://${ip}${SUFFIX}`,
    };
  }
  return {
    testUrl: `http://${ip}:${port}${SUFFIX}/api/sensor/latest`,
    baseUrl: `http://${ip}:${port}${SUFFIX}`,
  };
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/**
 * Scan jaringan lokal untuk menemukan server Flask TerraBreed via Nginx.
 *
 * - Subnet dideteksi otomatis dari IP DHCP perangkat (expo-network)
 * - Spiral scan mulai dari IP perangkat → server terdekat ditemukan lebih cepat
 * - Batch 40 IP paralel, timeout 2.5 detik per IP
 * - Port 80 → HTTP, port 443 → HTTPS, port lain → HTTP dengan port eksplisit
 *
 * @param port       Port Nginx/Flask (80 untuk HTTP, 443 untuk HTTPS)
 * @param onProgress Callback progress per-batch
 * @param cancelRef  Set cancelRef.current = true untuk hentikan scan
 */
export async function scanLocalNetwork(
  port: number,
  onProgress: (p: ScanProgress) => void,
  cancelRef: { current: boolean }
): Promise<ScanResult[]> {
  let deviceIp: string;
  try {
    deviceIp = await Network.getIpAddressAsync();
  } catch {
    throw new Error("Gagal membaca IP perangkat. Pastikan Wi-Fi aktif.");
  }

  if (!deviceIp || deviceIp === "0.0.0.0" || !deviceIp.includes(".")) {
    throw new Error(
      `IP perangkat tidak valid: "${deviceIp}".\n` +
        "Pastikan terhubung ke Wi-Fi (bukan data seluler)."
    );
  }

  const parts = deviceIp.split(".");
  if (parts.length !== 4) throw new Error(`Format IP tidak dikenali: ${deviceIp}`);

  const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.`;
  const myOctet = parseInt(parts[3], 10);
  const total = 254;
  const found: ScanResult[] = [];
  let scanned = 0;

  onProgress({ scanned: 0, total, subnet, found: [] });

  // Spiral dari IP perangkat → IP server yang dekat ditemukan di batch pertama
  const allOctets: number[] = [];
  for (let delta = 0; delta <= 254; delta++) {
    if (myOctet - delta >= 1) allOctets.push(myOctet - delta);
    if (delta > 0 && myOctet + delta <= 254) allOctets.push(myOctet + delta);
    if (allOctets.length >= 254) break;
  }

  const BATCH = 40;

  for (let b = 0; b < Math.ceil(allOctets.length / BATCH); b++) {
    if (cancelRef.current) break;

    const slice = allOctets.slice(b * BATCH, (b + 1) * BATCH);

    const batch = slice.map((octet) => {
      const ip = `${subnet}${octet}`;
      const { testUrl, baseUrl } = buildScanUrl(ip, port);
      const t0 = Date.now();

      return fetchWithTimeout(testUrl, TIMEOUT_MS)
        .then((res) =>
          res.ok
            ? ({ url: baseUrl, ip, port, latencyMs: Date.now() - t0 } as ScanResult)
            : null
        )
        .catch(() => null);
    });

    const results = await Promise.all(batch);
    scanned += slice.length;
    for (const r of results) if (r) found.push(r);
    onProgress({ scanned, total, subnet, found: [...found] });
  }

  return found;
}
