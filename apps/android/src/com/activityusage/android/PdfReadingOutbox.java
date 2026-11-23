package com.activityusage.android;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.Build;
import android.util.Log;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Queues confirmed viewing intervals until the phone's ActivityWatch server accepts them. */
final class PdfReadingOutbox extends SQLiteOpenHelper {
    private final SharedPreferences preferences;
    private final String bucketPath;
    private boolean bucketCreated;

    PdfReadingOutbox(Context context) {
        super(context, "pdf-reading.db", null, 1);
        preferences = context.getSharedPreferences("connection", Context.MODE_PRIVATE);
        String bucketId = preferences.getString("pdf_bucket_id", null);
        if (bucketId == null) {
            bucketId = "aw-watcher-pdf-android_" + UUID.randomUUID();
            preferences.edit().putString("pdf_bucket_id", bucketId).apply();
        }
        bucketPath = "/buckets/" + bucketId;
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE intervals (id INTEGER PRIMARY KEY, started INTEGER NOT NULL, " +
            "duration INTEGER NOT NULL, filename TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int from, int to) { }

    void record(long timestamp, long duration, String filename) {
        ContentValues values = new ContentValues();
        values.put("started", timestamp);
        values.put("duration", duration);
        values.put("filename", filename);
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
                "SELECT id, started, duration, filename FROM intervals ORDER BY id LIMIT 500", null)) {
                while (rows.moveToNext()) {
                    lastId = rows.getLong(0);
                    events.put(new JSONObject()
                        .put("timestamp", Instant.ofEpochMilli(rows.getLong(1)).toString())
                        .put("duration", rows.getLong(2) / 1000.0)
                        .put("data", new JSONObject().put("filename", rows.getString(3))));
                }
            }
            if (events.length() == 0) return;
            if (!bucketCreated) {
                JSONObject bucket = new JSONObject()
                    .put("client", "aw-watcher-pdf-android")
                    .put("type", "document.pdf.current")
                    .put("hostname", Build.MODEL);
                int status = post(bucketPath, key, bucket.toString());
                if (status != 200 && status != 304) return;
                bucketCreated = true;
            }
            int status = post(bucketPath + "/events", key, events.toString());
            if (status == 200) database.delete("intervals", "id <= ?", new String[] { Long.toString(lastId) });
            if (status == 404) bucketCreated = false;
        } catch (IOException | JSONException exception) {
            Log.d("PdfReadingOutbox", "PDF records are waiting for ActivityWatch.");
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
