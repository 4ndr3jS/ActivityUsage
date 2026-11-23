package com.activityusage.android;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.Build;
import android.util.Log;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Queues confirmed viewing intervals until the phone's ActivityWatch server accepts them. */
final class ActivityWatchOutbox extends SQLiteOpenHelper {
    enum Source {
        PDF("pdf-reading.db", "pdf_bucket_id", "aw-watcher-pdf-android", "document.pdf.current", "filename"),
        CHAPTER("chapter-reading.db", "chapter_bucket_id", "aw-watcher-anime-anyway-android", "web.tab.current", "title");

        final String database;
        final String bucketPreference;
        final String client;
        final String type;
        final String field;

        Source(String database, String bucketPreference, String client, String type, String field) {
            this.database = database;
            this.bucketPreference = bucketPreference;
            this.client = client;
            this.type = type;
            this.field = field;
        }
    }

    private final Source source;
    private final SharedPreferences preferences;
    private final String bucketPath;
    private boolean bucketCreated;

    ActivityWatchOutbox(Context context, Source source) {
        super(context, source.database, null, 1);
        this.source = source;
        preferences = context.getSharedPreferences("connection", Context.MODE_PRIVATE);
        String bucketId = preferences.getString(source.bucketPreference, null);
        if (bucketId == null) {
            bucketId = source.client + "_" + UUID.randomUUID();
            preferences.edit().putString(source.bucketPreference, bucketId).apply();
        }
        bucketPath = "/buckets/" + bucketId;
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE intervals (id INTEGER PRIMARY KEY, started INTEGER NOT NULL, " +
            "duration INTEGER NOT NULL, " + source.field + " TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int from, int to) { }

    void record(long timestamp, long duration, String title) {
        ContentValues values = new ContentValues();
        values.put("started", timestamp);
        values.put("duration", duration);
        values.put(source.field, title);
        getWritableDatabase().insertOrThrow("intervals", null, values);
        upload();
    }

    void upload() {
        if (!preferences.contains(LocalWebViewClient.KEY)) return;
        String key = preferences.getString(LocalWebViewClient.KEY, "");
        try {
            SQLiteDatabase database = getWritableDatabase();
            JSONArray events = new JSONArray();
            long lastId = 0;
            try (Cursor rows = database.rawQuery(
                "SELECT id, started, duration, " + source.field + " FROM intervals ORDER BY id LIMIT 500", null)) {
                while (rows.moveToNext()) {
                    lastId = rows.getLong(0);
                    events.put(new JSONObject()
                        .put("timestamp", Instant.ofEpochMilli(rows.getLong(1)).toString())
                        .put("duration", rows.getLong(2) / 1000.0)
                        .put("data", eventData(rows.getString(3))));
                }
            }
            if (events.length() == 0) return;
            if (!bucketCreated) {
                String hostname = source == Source.PDF ? Build.MODEL : androidWatcherHostname(key);
                if (hostname == null) return;
                JSONObject bucket = new JSONObject()
                    .put("client", source.client)
                    .put("type", source.type)
                    .put("hostname", hostname);
                int status = post(bucketPath, key, bucket.toString());
                if (status != 200 && status != 304) return;
                bucketCreated = true;
            }
            int status = post(bucketPath + "/events", key, events.toString());
            if (status == 200) database.delete("intervals", "id <= ?", new String[] { Long.toString(lastId) });
            if (status == 404) bucketCreated = false;
        } catch (IOException | JSONException exception) {
            Log.d("ActivityWatchOutbox", "Reading records are waiting for ActivityWatch.");
        }
    }

    private JSONObject eventData(String value) throws JSONException {
        JSONObject data = new JSONObject().put(source.field, value);
        if (source == Source.CHAPTER) {
            data.put("browser", AnimeAnywayReadingService.CHROME).put("url", "https://animeanyway.com");
        }
        return data;
    }

    private static String androidWatcherHostname(String key) throws IOException, JSONException {
        HttpURLConnection connection = LocalWebViewClient.open("/buckets/aw-watcher-android", key);
        try {
            if (connection.getResponseCode() != 200) return null;
            try (var body = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                StringBuilder json = new StringBuilder();
                for (String line; (line = body.readLine()) != null;) json.append(line);
                JSONObject bucket = new JSONObject(json.toString());
                String hostname = bucket.optString("hostname", "").trim();
                return hostname.isEmpty() || hostname.equalsIgnoreCase("unknown") ? null : hostname;
            }
        } finally {
            connection.disconnect();
        }
    }

    private static int post(String endpoint, String key, String body) throws IOException {
        HttpURLConnection connection = LocalWebViewClient.open(endpoint, key);
        try {
            byte[] data = body.getBytes(StandardCharsets.UTF_8);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setFixedLengthStreamingMode(data.length);
            try (var output = connection.getOutputStream()) {
                output.write(data);
            }
            return connection.getResponseCode();
        } finally {
            connection.disconnect();
        }
    }
}
