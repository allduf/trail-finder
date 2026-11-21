package com.allduf.trailgps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

// Keeps Trail Finder running while an offline map saves and you switch to another app (alex 2026-11-21: "can the app
// continue to download an offline map if you quite the app?"). Android only lets an app keep working out of sight from
// a "foreground service" that shows a notification ("Saving offline map: Whistler, 40%"). The page (offline.js) starts
// it with TrailGps.keepGoing({ on: true }) when a save starts and stops it when the save ends. Closing the app (swiping
// it away) still stops the save; the area then finishes the next time the app opens. Tapping the notification opens
// the app. Type dataSync: Google Play needs this declared in Play Console (App content > Foreground service permissions).
public class SaveService extends Service {
    private static final String CHANNEL = "offline-save";
    private static final int ID = 4713;
    static boolean on = false;
    private static boolean wanted = false;   // a save is running: a start that arrives after its stop ends itself
    static String title = "Saving offline map";
    static String text = "";

    // false when Android refused (the app wasn't on screen): the save still runs while the app is open.
    static boolean start(Context ctx) {
        wanted = true;
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, SaveService.class));
            return true;
        } catch (Exception ignored) {
            wanted = false;
            return false;
        }
    }

    static void stop(Context ctx) {
        wanted = false;
        try { ctx.stopService(new Intent(ctx, SaveService.class)); } catch (Exception ignored) {}
    }

    static void refresh(Context ctx) {
        if (!on) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.notify(ID, build(ctx)); } catch (Exception ignored) {}
        }
    }

    private static Notification build(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Offline map saving", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows while Trail Finder saves a map for use with no signal.");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(ctx, 0, open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int icon = ctx.getResources().getIdentifier("ic_stat_ride", "drawable", ctx.getPackageName());
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(icon != 0 ? icon : android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(tap)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, build(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, build(this));
            on = true;
        } catch (Exception e) {
            on = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!wanted) stopSelf();   // the save ended before Android got here
        return START_NOT_STICKY;
    }

    // Android 15 gives a data sync service 6 hours a day: it stops itself then (the area finishes on the next open).
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    // Swiped away from the recent apps: nothing left to keep going.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        on = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
