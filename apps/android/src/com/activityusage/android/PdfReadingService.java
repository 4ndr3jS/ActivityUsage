package com.activityusage.android;

import android.view.accessibility.AccessibilityNodeInfo;

public final class PdfReadingService extends ReadingTrackingService {
    private static final String NOTES = "com.samsung.android.app.notes";
    private static final String TOOLBAR_TITLE = NOTES + ":id/composer_toolbar_title";

    @Override
    protected String trackedPackage() { return NOTES; }

    @Override
    protected ActivityWatchOutbox createOutbox() {
        return new ActivityWatchOutbox(this, ActivityWatchOutbox.Source.PDF);
    }

    @Override
    protected String readTitle(AccessibilityNodeInfo root) {
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
}
