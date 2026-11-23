package com.activityusage.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

final class LocalWebViewClient extends WebViewClient {
    static final String HOST = "appassets.androidplatform.net";
    static final String START_PAGE = "https://" + HOST + "/index.html";
    static final String KEY = "activitywatch_api_key";
    static final String SYNC_FOLDER = "activityusage_sync_folder";
    private static final String SYNC_FILE = "activityusage-history.json.gz";
    private static final String API_ROOT = "http://127.0.0.1:5600/api/0";
    private static final String PROXY = "/activitywatch";
    private static final Map<String, String> TYPES = Map.of(
        "html", "text/html", "js", "text/javascript", "css", "text/css",
        "png", "image/png", "jpg", "image/jpeg", "svg", "image/svg+xml",
        "woff", "font/woff", "woff2", "font/woff2"
    );
    private final Context context;
    private final SharedPreferences preferences;

    LocalWebViewClient(Context context, SharedPreferences preferences) {
        this.context = context.getApplicationContext();
        this.preferences = preferences;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        return !isLocal(uri) || !"/index.html".equals(uri.getPath());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!isLocal(uri) || !"GET".equals(request.getMethod())) return error(403, "Forbidden");
        String path = uri.getEncodedPath();
        if (path == null) return error(404, "Not Found");
        if ("/synced-activity".equals(path)) return readSyncedActivity(request.getRequestHeaders().get("X-Snapshot-Version"));
        if (path.startsWith(PROXY + "/")) return readActivityWatch(path.substring(PROXY.length()), uri.getEncodedQuery());
        if (!path.equals("/index.html") && !path.equals("/activityusage.png") && !path.matches("/assets/[A-Za-z0-9_.-]+")) {
            return error(404, "Not Found");
        }
        try {
            String type = TYPES.getOrDefault(path.substring(path.lastIndexOf('.') + 1), "application/octet-stream");
            String encoding = type.startsWith("text/") ? "UTF-8" : null;
            return new WebResourceResponse(type, encoding, context.getAssets().open("www" + path));
        } catch (IOException exception) {
            return error(404, "Not Found");
        }
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private WebResourceResponse readSyncedActivity(String cachedVersion) {
        String folder = preferences.getString(SYNC_FOLDER, "");
        if (folder.isEmpty()) return error(404, "Sync folder not set");
        Uri tree = Uri.parse(folder);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] columns = { Document.COLUMN_DISPLAY_NAME, Document.COLUMN_DOCUMENT_ID, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_SIZE };
        try (Cursor cursor = context.getContentResolver().query(children, columns, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                if (!SYNC_FILE.equals(cursor.getString(0))) continue;
                long modified = cursor.getLong(2);
                long size = cursor.getLong(3);
                if (size <= 0 || size > 32L * 1024 * 1024) break;
                String version = modified + "-" + size;
                if (version.equals(cachedVersion)) return error(204, "Unchanged");
                Uri file = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(1));
                InputStream input = context.getContentResolver().openInputStream(file);
                if (input != null) return new WebResourceResponse("application/gzip", null, 200, "OK",
                    Map.of("Cache-Control", "no-store", "X-Snapshot-Version", version), input);
            }
        } catch (IOException | IllegalArgumentException | SecurityException exception) {
            return error(503, "Sync folder unavailable");
        }
        return error(404, "Waiting for desktop history");
    }

    private WebResourceResponse readActivityWatch(String path, String query) {
        if (!path.equals("/buckets/") && !path.equals("/settings/classes") && !path.matches("/buckets/[^/]+/events")) {
            return error(404, "Not Found");
        }
        HttpURLConnection connection = null;
        try {
            String endpoint = query == null ? path : path + "?" + query;
            connection = open(endpoint, preferences.getString(KEY, ""));
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                connection.disconnect();
                return status >= 400 && status <= 599 ? error(status, "ActivityWatch error") : error(502, "Bad Gateway");
            }
            HttpURLConnection upstream = connection;
            InputStream body = new FilterInputStream(connection.getInputStream()) {
                @Override
                public void close() throws IOException {
                    try { super.close(); } finally { upstream.disconnect(); }
                }
            };
            return new WebResourceResponse("application/json", "UTF-8", status, "OK", Map.of("Cache-Control", "no-store"), body);
        } catch (IOException exception) {
            if (connection != null) connection.disconnect();
            return error(503, "ActivityWatch unavailable");
        }
    }

    static int checkKey(String key) throws IOException {
        HttpURLConnection connection = open("/buckets/", key);
        try {
            return connection.getResponseCode();
        } finally {
            connection.disconnect();
        }
    }

    static HttpURLConnection open(String endpoint, String key) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(API_ROOT + endpoint).openConnection();
        connection.setConnectTimeout(3000);
        connection.setReadTimeout(10_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        if (!key.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + key);
        return connection;
    }

    private static WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, Map.of("Cache-Control", "no-store"),
            new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }
}
