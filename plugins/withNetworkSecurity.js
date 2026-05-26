const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Plugin ini inject network_security_config.xml ke dalam android res/xml
// agar HTTPS ke kendo-assistant.com dengan self-signed cert bisa connect

const withNetworkSecurity = (config) => {
  // Step 1: tambah android:networkSecurityConfig ke AndroidManifest
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (manifest.$) {
      manifest.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return config;
  });

  // Step 2: buat file network_security_config.xml di res/xml
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml"
      );
      if (!fs.existsSync(xmlDir)) fs.mkdirSync(xmlDir, { recursive: true });

      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">kendo-assistant.com</domain>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </domain-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
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
