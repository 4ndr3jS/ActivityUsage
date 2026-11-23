package com.activityusage.android;

import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayDeque;
import java.util.regex.Pattern;

public final class AnimeAnywayReadingService extends ReadingTrackingService {
    static final String CHROME = "com.android.chrome";
    private static final String URL_BAR = CHROME + ":id/url_bar";
    private static final String INCOGNITO_BADGE = CHROME + ":id/incognito_badge";
    private static final Pattern SITE = Pattern.compile(
        "^(?:https?://)?(?:www\\.)?animeanyway\\.com(?:[/?#]\\S*)?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern CHAPTER_TITLE = Pattern.compile(
        "^(?:(?:chapter\\s+\\d+(?:\\.\\d+)?|prologue|epilogue|interlude|afterword)\\s*\\|\\s*)?"
            + "year\\s+\\d+\\s+volume\\s+\\d+(?:\\.\\d+)?\\s*\\|\\s*anime anyway$",
        Pattern.CASE_INSENSITIVE);

    @Override
    protected String trackedPackage() { return CHROME; }

    @Override
    protected long inspectionDelayMs() { return 700; }

    @Override
    protected ActivityWatchOutbox createOutbox() {
        return new ActivityWatchOutbox(this, ActivityWatchOutbox.Source.CHAPTER);
    }

    @Override
    protected String readTitle(AccessibilityNodeInfo root) {
        if (!root.findAccessibilityNodeInfosByViewId(INCOGNITO_BADGE).isEmpty()) return null;
        var addressBars = root.findAccessibilityNodeInfosByViewId(URL_BAR);
        if (addressBars.size() != 1) return null;
        var bar = addressBars.get(0);
        String address = text(bar.getText());
        if (bar.isFocused() || address == null || !SITE.matcher(address).matches()) return null;

        // Chromium exposes the document as a WebView. Read its name and skip the page contents.
        var nodes = new ArrayDeque<AccessibilityNodeInfo>();
        nodes.add(root);
        String title = null;
        for (int visited = 0; !nodes.isEmpty() && visited < 160; visited++) {
            var node = nodes.removeFirst();
            if ("android.webkit.WebView".equals(text(node.getClassName()))) {
                if (!node.isVisibleToUser()) continue;
                String candidate = chapterTitle(node.getContentDescription());
                if (candidate == null) candidate = chapterTitle(node.getText());
                if (candidate == null) continue;
                if (title != null && !title.equals(candidate)) return null;
                title = candidate;
                continue;
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                var child = node.getChild(i);
                if (child != null) nodes.addLast(child);
            }
        }
        return title;
    }

    private static String chapterTitle(CharSequence value) {
        String title = text(value);
        return title != null && title.length() <= 160 && CHAPTER_TITLE.matcher(title).matches() ? title : null;
    }

    private static String text(CharSequence value) {
        return value == null ? null : value.toString().trim();
    }
}
