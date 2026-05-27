const { withMainApplication } = require("@expo/config-plugins");

  /**
   * Plugin ini patch MainApplication untuk bypass SSL verification.
   * Mendukung Old Architecture (OkHttp) DAN New Architecture (HttpsURLConnection).
   */
  const withTrustAllCerts = (config) => {
    config = withMainApplication(config, (config) => {
      let contents = config.modResults.contents;

      // Tambah import SSL + HttpsURLConnection
      const sslImports = `import javax.net.ssl.*;
  import java.security.cert.X509Certificate;
  import okhttp3.OkHttpClient;
  import com.facebook.react.modules.network.OkHttpClientProvider;
  import com.facebook.react.modules.network.ReactCookieJarContainer;`;

      if (!contents.includes("javax.net.ssl")) {
        contents = contents.replace(
          "import com.facebook.react.ReactApplication;",
          `${sslImports}\nimport com.facebook.react.ReactApplication;`
        );
      }

      // Inject SSL bypass di onCreate – mendukung Old Arch (OkHttp) dan New Arch (HttpsURLConnection)
      const onCreatePatch = `
      // Bypass SSL untuk self-signed cert (Old Arch + New Arch)
      try {
        TrustManager[] trustManagers = new TrustManager[]{
          new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] chain, String authType) {}
            public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
          }
        };
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, trustManagers, new java.security.SecureRandom());

        // Old Architecture: patch OkHttp via ReactNative bridge
        OkHttpClientProvider.setOkHttpClientFactory(() ->
          new OkHttpClient.Builder()
            .cookieJar(new ReactCookieJarContainer())
            .sslSocketFactory(sslContext.getSocketFactory(), (X509TrustManager) trustManagers[0])
            .hostnameVerifier((hostname, session) -> true)
            .build()
        );

        // New Architecture: patch HttpsURLConnection default factory
        HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.getSocketFactory());
        HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);

      } catch (Exception e) {
        e.printStackTrace();
      }`;

      if (!contents.includes("TrustManager[]") && contents.includes("super.onCreate()")) {
        contents = contents.replace(
          "super.onCreate();",
          `super.onCreate();\n${onCreatePatch}`
        );
      }

      config.modResults.contents = contents;
      return config;
    });

    return config;
  };

  module.exports = withTrustAllCerts;
  