package com.allduf.trailfinder;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

// The Android app: the live website in Capacitor's web view (like ios-app/ on the iPhone).
// One change to Capacitor's own handling: a photo box (photo find, trail and ride photos, ski points) offers
// the camera too, next to the gallery and files, like the iPhone's "Take Photo / Photo Library". Capacitor alone
// only shows the gallery unless the page asks for the camera only.
public class MainActivity extends BridgeActivity {
    private ValueCallback<Uri[]> pending;
    private Uri cameraUri;
    private ActivityResultLauncher<Intent> picker;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        picker = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), (res) -> {
            ValueCallback<Uri[]> cb = pending;
            pending = null;
            if (cb == null) return;
            Uri[] out = null;
            Intent data = res.getData();
            if (res.getResultCode() == RESULT_OK) {
                if (data != null && data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    out = new Uri[n];
                    for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data != null && data.getData() != null) {
                    out = new Uri[] { data.getData() };
                } else if (cameraUri != null && cameraFileHasPicture()) {
                    out = new Uri[] { cameraUri };
                }
            }
            cb.onReceiveValue(out);
        });
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params) {
                List<String> types = Arrays.asList(params.getAcceptTypes());
                boolean images = false;
                for (String t : types) if (t.startsWith("image/")) images = true;
                if (params.isCaptureEnabled() || !images) return super.onShowFileChooser(view, cb, params);
                return pickWithCamera(cb, params);
            }
        });
    }

    private File cameraFile;

    private boolean cameraFileHasPicture() { return cameraFile != null && cameraFile.exists() && cameraFile.length() > 0; }

    private boolean pickWithCamera(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params) {
        if (pending != null) pending.onReceiveValue(null);
        pending = cb;
        Intent pick = params.createIntent();
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        List<String> mimes = new ArrayList<>();
        for (String t : params.getAcceptTypes()) if (t.contains("/")) mimes.add(t.trim());
        if (mimes.size() > 1) {
            pick.setType("*/*");
            pick.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        List<Intent> extra = new ArrayList<>();
        try {
            File dir = new File(getCacheDir(), "camera");
            dir.mkdirs();
            cameraFile = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", cameraFile);
            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (cam.resolveActivity(getPackageManager()) != null) extra.add(cam);
        } catch (Exception e) {
            cameraUri = null;
            cameraFile = null;
        }
        Intent chooser = Intent.createChooser(pick, null);
        if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
        try {
            picker.launch(chooser);
        } catch (Exception e) {
            pending = null;
            cb.onReceiveValue(null);
        }
        return true;
    }
}
