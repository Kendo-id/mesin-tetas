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
const TIMEOUT_MS = 2000;

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/**
 * Scan jaringan lokal untuk menemukan server Flask TerraBreed.
 *
 * - Subnet dideteksi otomatis dari IP DHCP perangkat (via expo-network)
 * - Scan spiral keluar dari IP perangkat sendiri → server lokal ditemukan lebih cepat
 * - Batch paralel 40 IP sekaligus, timeout 2 detik per IP
 *
 * @param port       Port Flask server (biasanya 5000)
 * @param onProgress Callback progress per-batch (untuk update UI)
 * @param cancelRef  Set cancelRef.current = true untuk menghentikan scan
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

  // Susun urutan oktet ke-4: spiral dari posisi perangkat
  // sehingga IP tetangga terdekat dicek lebih dulu
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
      const testUrl = `http://${ip}:${port}${SUFFIX}/api/sensor/latest`;
      const baseUrl = `http://${ip}:${port}${SUFFIX}`;
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
