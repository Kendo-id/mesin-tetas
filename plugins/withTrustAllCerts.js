const { withDangerousMod } = require("@expo/config-plugins");
  const fs = require("fs");
  const path = require("path");

  const withTrustAllCerts = (config) => {
    config = withDangerousMod(config, [
      "android",
      async (config) => {
        const packageName = config.android?.package ?? "com.kendokenceng.terrabreed";
        const packagePath = packageName.replace(/\./g, "/");
        const srcDir = path.join(
          config.modRequest.platformProjectRoot,
          "app/src/main/java", packagePath
        );
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

        // Kotlin OkHttp factory — trust semua cert untuk host lokal
        // RN 0.74+ mengubah nama method: createNewNetworkModuleOkHttpClient → createNewNetworkModuleClient
        fs.writeFileSync(path.join(srcDir, "SSLBypassOkHttpFactory.kt"), `package ${packageName}

  import com.facebook.react.modules.network.OkHttpClientFactory
  import com.facebook.react.modules.network.ReactCookieJarContainer
  import okhttp3.OkHttpClient
  import java.security.SecureRandom
  import java.security.cert.X509Certificate
  import javax.net.ssl.*

  class SSLBypassOkHttpFactory : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient {
          val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
              override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
              override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
              override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
          })
          val ctx = SSLContext.getInstance("TLS").also { it.init(null, trustAll, SecureRandom()) }
          return OkHttpClient.Builder()
              .cookieJar(ReactCookieJarContainer())
              .sslSocketFactory(ctx.socketFactory, trustAll[0] as X509TrustManager)
              .hostnameVerifier { _, _ -> true }
              .build()
      }
  }
  `);

        // Patch MainApplication.kt
        const mainAppPath = path.join(srcDir, "MainApplication.kt");
        if (fs.existsSync(mainAppPath)) {
          let src = fs.readFileSync(mainAppPath, "utf8");
          const importLine = "import com.facebook.react.modules.network.OkHttpClientProvider";
          if (!src.includes(importLine)) {
            src = src.replace(
              "import com.facebook.react.ReactApplication",
              `${importLine}\nimport com.facebook.react.ReactApplication`
            );
          }
          if (!src.includes("SSLBypassOkHttpFactory")) {
            src = src.replace(
              "super.onCreate()",
              `super.onCreate()\n        OkHttpClientProvider.setOkHttpClientFactory(SSLBypassOkHttpFactory())`
            );
          }
          fs.writeFileSync(mainAppPath, src);
          console.log("[withTrustAllCerts] MainApplication.kt patched ✅");
        } else {
          console.warn("[withTrustAllCerts] MainApplication.kt not found, will retry at prebuild");
        }
        return config;
      },
    ]);

    return config;
  };

  module.exports = withTrustAllCerts;
  