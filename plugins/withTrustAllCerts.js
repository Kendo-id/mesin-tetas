const { withMainApplication } = require("@expo/config-plugins");

/**
 * Plugin ini patch MainApplication untuk bypass SSL verification
 * khusus untuk domain kendo-assistant.com.
 * 
 * Cara kerja: inject OkHttpClient custom yang trust semua cert
 * untuk host tertentu saja (bukan trust-all global).
 */
const withTrustAllCerts = (config) => {
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Tambah import SSL
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

    // Inject override OkHttp di onCreate
    const onCreatePatch = `
    // Trust self-signed cert untuk kendo-assistant.com
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
      OkHttpClientProvider.setOkHttpClientFactory(() -> 
        new OkHttpClient.Builder()
          .cookieJar(new ReactCookieJarContainer())
          .sslSocketFactory(sslContext.getSocketFactory(), (X509TrustManager) trustManagers[0])
          .hostnameVerifier((hostname, session) -> hostname.contains("kendo-assistant.com"))
          .build()
      );
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
