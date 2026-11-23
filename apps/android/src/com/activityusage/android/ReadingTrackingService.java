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

abstract class ReadingTrackingService extends AccessibilityService {
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
    private ActivityWatchOutbox outbox;
    private PowerManager power;
    private KeyguardManager keyguard;
    private boolean receiverRegistered;
    private String title;
    private long startedAt;
    private long startedElapsed;
    private long lastSeen;

    protected abstract String trackedPackage();
    protected abstract String readTitle(AccessibilityNodeInfo root);
    protected abstract ActivityWatchOutbox createOutbox();
    protected long inspectionDelayMs() { return 120; }

    @Override
    protected void onServiceConnected() {
        if (receiverRegistered) return;
        outbox = createOutbox();
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
            !trackedPackage().contentEquals(event.getPackageName() == null ? "" : event.getPackageName())) return;
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
        if (!handler.hasCallbacks(inspect)) handler.postDelayed(inspect, inspectionDelayMs());
    }

    private void inspectViewer() {
        handler.removeCallbacks(refresh);
        long now = SystemClock.elapsedRealtime();
        String current = power.isInteractive() && !keyguard.isKeyguardLocked() ? readActiveTitle() : null;
        update(current, now);
        if (current != null) handler.postDelayed(refresh, SAMPLE_MS);
    }

    private String readActiveTitle() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return root != null && root.getPackageName() != null && trackedPackage().contentEquals(root.getPackageName())
            ? readTitle(root) : null;
    }

    private void update(String next, long now) {
        if (title != null) {
            boolean gap = now - lastSeen > MAX_GAP_MS;
            boolean changed = !title.equals(next);
            if (gap || changed || now - startedElapsed >= SAVE_MS) {
                long end = gap ? lastSeen : now;
                long duration = end - startedElapsed;
                String saved = title;
                long timestamp = startedAt;
                if (duration > 0) io.execute(() -> outbox.record(timestamp, duration, saved));
                title = null;
            }
        }
        if (next != null && title == null) {
            title = next;
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
