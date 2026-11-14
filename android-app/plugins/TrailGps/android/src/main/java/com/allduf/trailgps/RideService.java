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

// Keeps Trail Finder running with the screen off while a ride records or live location is on, so the GPS keeps going
// (Android only allows that from a "foreground service", which must show a notification). The notification shows the
// ride: km and climb, the trail you're on, or the next turn with directions (GpsEngine.notificationText), like the
// iPhone's lock screen. Tapping it opens the app.
public class RideService extends Service {
    private static final String CHANNEL = "ride";
    private static final int ID = 4711;
    private static boolean on = false;

    static void start(Context ctx) {
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, RideService.class));
        } catch (Exception ignored) {
            // Android refused (the app wasn't on screen): the GPS still runs while the app is open.
        }
    }

    static void stop(Context ctx) {
        if (!on) return;
        ctx.stopService(new Intent(ctx, RideService.class));
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
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Ride recording and live location", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows while Trail Finder records a ride or shares your location.");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
        String[] text = GpsEngine.get(ctx).notificationText();
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(ctx, 0, open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int icon = ctx.getResources().getIdentifier("ic_stat_ride", "drawable", ctx.getPackageName());
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(icon != 0 ? icon : android.R.drawable.ic_menu_mylocation)
            .setContentTitle(text[0])
            .setContentText(text[1])
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(GpsEngine.get(ctx).actOn)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(tap)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, build(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(ID, build(this));
            on = true;
        } catch (Exception e) {
            // No location permission any more, or Android said no: stop quietly (the page's GPS still works on screen).
            on = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!GpsEngine.get(this).running) { stopSelf(); return START_NOT_STICKY; }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        on = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
