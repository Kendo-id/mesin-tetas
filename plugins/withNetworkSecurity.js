const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Plugin ini inject network_security_config.xml ke Android build.
 * 
 * Tujuan:
 * 1. Allow HTTPS ke kendo-assistant.com meski pakai self-signed cert
 * 2. Trust user-installed certificates (untuk install cert manual)
 * 3. Allow cleartext HTTP ke IP lokal (untuk development/fallback)
 */
const withNetworkSecurity = (config) => {
  // Step 1: Tambah android:networkSecurityConfig ke AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (manifest.$) {
      manifest.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return config;
  });

  // Step 2: Buat file XML-nya di res/xml
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml"
      );
      if (!fs.existsSync(xmlDir)) {
        fs.mkdirSync(xmlDir, { recursive: true });
      }

      // Trust semua cert untuk kendo-assistant.com (termasuk self-signed)
      // Allow HTTP untuk IP lokal (192.168.x.x, 10.x.x.x)
      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- kendo-assistant.com: trust semua termasuk self-signed -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">kendo-assistant.com</domain>
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="user"/>
        </trust-anchors>
    </domain-config>

    <!-- IP lokal: allow HTTP biasa untuk development/fallback -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">192.168.1.0</domain>
        <domain includeSubdomains="false">192.168.0.0</domain>
        <domain includeSubdomains="false">10.0.0.0</domain>
        <domain includeSubdomains="false">10.10.10.0</domain>
        <domain includeSubdomains="false">172.16.0.0</domain>
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="user"/>
        </trust-anchors>
    </domain-config>

    <!-- Debug overrides: trust user-installed cert di semua build -->
    <debug-overrides>
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="user"/>
        </trust-anchors>
    </debug-overrides>

    <!-- Base config: default trust system CA saja -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="user"/>
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
