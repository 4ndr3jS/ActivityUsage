package com.activityusage.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int SAVE_EXPORT = 1;
    private static final int CHOOSE_SYNC_FOLDER = 2;
    private static final String WATCH_PACKAGE = "net.activitywatch.android";
    private static final int MAX_EXPORT_SIZE = 15 * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private WebView webView;
    private String pendingExport;
    private AlertDialog connectionDialog;

    @Override
    public void onCreate(Bundle state) {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        setTheme(dark ? android.R.style.Theme_Material_NoActionBar : android.R.style.Theme_Material_Light_NoActionBar);
        super.onCreate(state);
        preferences = getSharedPreferences("connection", MODE_PRIVATE);
        getWindow().setDecorFitsSystemWindows(false);

        FrameLayout layout = new FrameLayout(this);
        layout.setBackgroundColor(dark ? Color.rgb(12, 15, 25) : Color.rgb(245, 245, 247));
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsets.CONSUMED;
        });
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new LocalWebViewClient(this, preferences));
        webView.addJavascriptInterface(new AppBridge(), "ActivityUsageAndroid");
        layout.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(layout);
        layout.post(() -> {
            int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            WindowInsetsController controller = layout.getWindowInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(dark ? 0 : lightBars, lightBars);
        });
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        if (state == null || webView.restoreState(state) == null) webView.loadUrl(LocalWebViewClient.START_PAGE);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        webView.pauseTimers();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        webView.resumeTimers();
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        if (connectionDialog != null) connectionDialog.dismiss();
        webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() { goBack(); }

    private void goBack() {
        // Close the date/options overlay before navigating away from its page.
        webView.evaluateJavascript("(() => { if (!document.querySelector('[role=dialog]')) return false; "
            + "document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true})); return true; })()", handled -> {
            if ("true".equals(handled)) return;
            if (webView.canGoBack()) webView.goBack();
            else finish();
        });
    }

    private final class AppBridge {
        @JavascriptInterface
        public boolean hasConnection() { return preferences.contains(LocalWebViewClient.KEY); }

        @JavascriptInterface
        public void openActivityWatch() {
            runOnUiThread(() -> {
                Intent intent = getPackageManager().getLaunchIntentForPackage(WATCH_PACKAGE);
                if (intent != null) startActivity(intent);
                else Toast.makeText(MainActivity.this, "Install and open ActivityWatch first.", Toast.LENGTH_LONG).show();
            });
        }

        @JavascriptInterface
        public void connectActivityWatch() { runOnUiThread(MainActivity.this::showConnectionDialog); }

        @JavascriptInterface
        public boolean hasSyncFolder() { return preferences.contains(LocalWebViewClient.SYNC_FOLDER); }

        @JavascriptInterface
        public void chooseSyncFolder() {
            runOnUiThread(() -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),
                CHOOSE_SYNC_FOLDER));
        }

        @JavascriptInterface
        public void openAccessibilitySettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        }

        @JavascriptInterface
        public void saveExport(String json) { runOnUiThread(() -> chooseExportFile(json)); }
    }

    private void showConnectionDialog() {
        if (connectionDialog != null && connectionDialog.isShowing()) return;
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("ActivityWatch API key");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setImportantForAutofill(EditText.IMPORTANT_FOR_AUTOFILL_NO);
        FrameLayout content = new FrameLayout(this);
        int side = Math.round(24 * getResources().getDisplayMetrics().density);
        content.setPadding(side, 0, side, 0);
        content.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Connect ActivityWatch")
            .setView(content)
            .setNegativeButton("Cancel", null)
            .setNeutralButton("Paste key", null)
            .setPositiveButton("Connect", null)
            .create();
        connectionDialog = dialog;
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> {
            ClipboardManager clipboard = getSystemService(ClipboardManager.class);
            ClipData contents = clipboard.getPrimaryClip();
            CharSequence text = contents == null ? null : contents.getItemAt(0).getText();
            if (text == null || text.length() == 0) input.setError("Copy the API key from ActivityWatch first.");
            else {
                input.setText(text);
                input.setError(null);
            }
        });
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> pair(dialog, input));
    }

    private void pair(AlertDialog dialog, EditText input) {
        String key = input.getText().toString().trim();
        if (key.length() > 1024 || key.chars().anyMatch(character -> character <= 32 || character >= 127)) {
            input.setError("Paste only the API key from ActivityWatch.");
            return;
        }
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
        io.execute(() -> {
            String error;
            try {
                int status = LocalWebViewClient.checkKey(key);
                error = status == 200 ? null : status == 401
                    ? "Copy the current key from ActivityWatch's API Authentication screen."
                    : "ActivityWatch is unavailable. Open it and try again.";
            } catch (IOException exception) {
                error = "Open ActivityWatch and try again.";
            }
            String result = error;
            runOnUiThread(() -> {
                if (isDestroyed() || !dialog.isShowing()) return;
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                if (result != null) {
                    input.setError(result);
                    return;
                }
                preferences.edit().putString(LocalWebViewClient.KEY, key).apply();
                ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                ClipData contents = clipboard.getPrimaryClip();
                CharSequence clipboardText = contents == null ? null : contents.getItemAt(0).getText();
                if (!key.isEmpty() && clipboardText != null && key.contentEquals(clipboardText)) {
                    clipboard.clearPrimaryClip();
                }
                dialog.dismiss();
                sendEvent("window.dispatchEvent(new Event('activityusage:android-connected'))");
            });
        });
    }

    private void chooseExportFile(String json) {
        if (pendingExport != null || json == null || json.length() > MAX_EXPORT_SIZE) {
            exportResult("null");
            return;
        }
        pendingExport = json;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json")
            .putExtra(Intent.EXTRA_TITLE, "activityusage-summary.json");
        try {
            startActivityForResult(intent, SAVE_EXPORT);
        } catch (android.content.ActivityNotFoundException exception) {
            pendingExport = null;
            exportResult("null");
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == CHOOSE_SYNC_FOLDER) {
            if (result == RESULT_OK && data != null && data.getData() != null) {
                Uri folder = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(folder, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    String previous = preferences.getString(LocalWebViewClient.SYNC_FOLDER, "");
                    preferences.edit().putString(LocalWebViewClient.SYNC_FOLDER, folder.toString()).apply();
                    if (!previous.isEmpty() && !folder.toString().equals(previous)) {
                        try {
                            getContentResolver().releasePersistableUriPermission(Uri.parse(previous), Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        } catch (SecurityException ignored) { }
                    }
                    sendEvent("window.dispatchEvent(new Event('activityusage:android-connected'))");
                } catch (SecurityException exception) {
                    Toast.makeText(this, "This folder cannot be opened for sync.", Toast.LENGTH_LONG).show();
                }
            }
            return;
        }
        if (request != SAVE_EXPORT) return;
        String json = pendingExport;
        pendingExport = null;
        if (result != RESULT_OK || data == null || data.getData() == null || json == null) {
            exportResult("false");
            return;
        }
        io.execute(() -> {
            String outcome = "null";
            try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                if (out != null) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                    outcome = "true";
                }
            } catch (IOException | SecurityException exception) {
                outcome = "null";
            }
            String response = outcome;
            runOnUiThread(() -> exportResult(response));
        });
    }

    private void exportResult(String result) {
        sendEvent("window.dispatchEvent(new CustomEvent('activityusage:android-export',{detail:" + result + "}))");
    }

    private void sendEvent(String script) {
        if (!isDestroyed()) webView.evaluateJavascript(script, null);
    }
}
