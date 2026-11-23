package com.activityusage.android;

import android.accessibilityservice.AccessibilityService;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class PdfReadingService extends AccessibilityService {
    private static final String NOTES = "com.samsung.android.app.notes";
    private static final String TOOLBAR_TITLE = NOTES + ":id/composer_toolbar_title";
    private static final long SAMPLE_MS = 5_000;
    private static final long MAX_GAP_MS = 15_000;
    private static final long SAVE_MS = 30_000;
    private static final long RETRY_MS = 60_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Runnable inspect = this::inspectViewer;
    private final Runnable refresh = this::inspectViewer;
    private final Runnable retry = this::retryUpload;
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                update(null, SystemClock.elapsedRealtime());
                handler.removeCallbacks(inspect);
                handler.removeCallbacks(refresh);
            } else {
                scheduleInspection();
            }
        }
    };
    private PdfReadingOutbox outbox;
    private PowerManager power;
    private KeyguardManager keyguard;
    private boolean receiverRegistered;
    private String filename;
    private long startedAt;
    private long startedElapsed;
    private long lastSeen;

    @Override
    protected void onServiceConnected() {
        if (receiverRegistered) return;
        outbox = new PdfReadingOutbox(this);
        power = getSystemService(PowerManager.class);
        keyguard = getSystemService(KeyguardManager.class);
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        registerReceiver(screen, filter);
        receiverRegistered = true;
        scheduleInspection();
        retryUpload();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!receiverRegistered) return;
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            !NOTES.contentEquals(event.getPackageName() == null ? "" : event.getPackageName())) return;
        scheduleInspection();
    }

    @Override
    public void onInterrupt() {
        update(null, SystemClock.elapsedRealtime());
        handler.removeCallbacks(inspect);
        handler.removeCallbacks(refresh);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (receiverRegistered) {
            update(null, SystemClock.elapsedRealtime());
            unregisterReceiver(screen);
            io.execute(outbox::close);
        }
        io.shutdown();
        super.onDestroy();
    }

    private void scheduleInspection() {
        if (!handler.hasCallbacks(inspect)) handler.postDelayed(inspect, 120);
    }

    private void inspectViewer() {
        handler.removeCallbacks(refresh);
        long now = SystemClock.elapsedRealtime();
        String current = power.isInteractive() && !keyguard.isKeyguardLocked() ? readPdfFilename() : null;
        update(current, now);
        if (current != null) handler.postDelayed(refresh, SAMPLE_MS);
    }

    private String readPdfFilename() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !NOTES.contentEquals(root.getPackageName())) return null;
        boolean pdfReader = false;
        String title = null;
        for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByViewId(TOOLBAR_TITLE)) {
            if (!node.isVisibleToUser() || node.getText() == null) continue;
            String text = node.getText().toString().trim();
            if ("PDF reader".equalsIgnoreCase(text)) pdfReader = true;
            else if (!text.isEmpty() && title == null) title = text;
            else if (!text.isEmpty() && !text.equals(title)) return null;
        }
        if (!pdfReader || title == null || title.matches(".*[\\\\/\\p{Cntrl}].*")) return null;
        String file = title.regionMatches(true, title.length() - 4, ".pdf", 0, 4) ? title : title + ".pdf";
        return file.length() > 4 && file.length() <= 255 ? file : null;
    }

    private void update(String next, long now) {
        if (filename != null) {
            boolean gap = now - lastSeen > MAX_GAP_MS;
            boolean changed = !filename.equals(next);
            if (gap || changed || now - startedElapsed >= SAVE_MS) {
                long end = gap ? lastSeen : now;
                long duration = end - startedElapsed;
                String saved = filename;
                long timestamp = startedAt;
                if (duration > 0) io.execute(() -> outbox.record(timestamp, duration, saved));
                filename = null;
            }
        }
        if (next != null && filename == null) {
            filename = next;
            startedAt = System.currentTimeMillis();
            startedElapsed = now;
        }
        lastSeen = now;
    }

    private void retryUpload() {
        io.execute(outbox::upload);
        handler.postDelayed(retry, RETRY_MS);
    }
}
