package com.allduf.trailreview;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

// Google Play's own rating card (alex 2026-11-19: ask for a rating at a happy moment), the same call as the iPhone's
// TrailReview. rate.js on the website decides when and calls requestReview(). Google Play decides whether the card
// really shows (it has its own limits, and only for an app installed from Play) and never says what was given.
@CapacitorPlugin(name = "TrailReview")
public class TrailReviewPlugin extends Plugin {
    @PluginMethod
    public void requestReview(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) { done(call, false); return; }
        ReviewManager manager = ReviewManagerFactory.create(activity);
        manager.requestReviewFlow().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) { done(call, false); return; }
            ReviewInfo info = task.getResult();
            manager.launchReviewFlow(activity, info).addOnCompleteListener(t -> done(call, true));
        });
    }

    private void done(PluginCall call, boolean asked) {
        JSObject r = new JSObject();
        r.put("asked", asked);
        call.resolve(r);
    }
}
