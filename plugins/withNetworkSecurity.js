const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const withNetworkSecurity = (config) => {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (manifest.$) {
      manifest.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return config;
  });

  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml"
      );
      if (!fs.existsSync(xmlDir)) fs.mkdirSync(xmlDir, { recursive: true });

      // Izinkan HTTP untuk jaringan lokal (192.168.x.x, 10.x.x.x, 172.16.x.x)
      // agar user bisa koneksi ke server Flask via IP lokal tanpa HTTPS.
      // HTTPS tetap required untuk kendo-assistant.com (production).
      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Server produksi: HTTPS wajib, trust system + user cert (self-signed ok) -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">kendo-assistant.com</domain>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </domain-config>

    <!-- Jaringan lokal: izinkan HTTP (http://192.168.x.x, http://10.x.x.x, dll) -->
    <!-- Android tidak mendukung CIDR di network-security-config,             -->
    <!-- solusinya: base-config cleartextTrafficPermitted="true" +            -->
    <!-- domain-config khusus untuk produksi yang tetap enforce HTTPS.        -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>`;

      fs.writeFileSync(
        path.join(xmlDir, "network_security_config.xml"),
        xmlContent
      );
      return config;
    },
  ]);

  return config;
};

module.exports = withNetworkSecurity;
