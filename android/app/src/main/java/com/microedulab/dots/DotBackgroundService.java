package com.microedulab.dots;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class DotBackgroundService extends Service {
    private ScheduledExecutorService executor;
    private static final String SERVICE_CHANNEL = "dots-presence", UPDATE_CHANNEL = "dots-updates";
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(SERVICE_CHANNEL, "私人伙伴后台连接", NotificationManager.IMPORTANCE_LOW));
            manager.createNotificationChannel(new NotificationChannel(UPDATE_CHANNEL, "任务与授权提醒", NotificationManager.IMPORTANCE_DEFAULT));
        }
        startForeground(4100, notification(SERVICE_CHANNEL, "绒点在你身边", "后台接收任务完成与授权提醒，可在应用设置中关闭。", false));
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::refresh, 2, 30, TimeUnit.SECONDS);
    }
    private Notification notification(String channel, String title, String message, boolean autoCancel) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent intent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, channel).setSmallIcon(R.drawable.ic_stat_dot).setContentTitle(title).setContentText(message).setContentIntent(intent)
            .setOngoing(!autoCancel).setAutoCancel(autoCancel).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).build();
    }
    private void refresh() {
        HttpURLConnection connection = null;
        try {
            String token = Vault.read(this);
            if (token.isEmpty()) { stopSelf(); return; }
            long after = getSharedPreferences("dots_updates", MODE_PRIVATE).getLong("cursor", -1);
            connection = (HttpURLConnection) new URL(BuildConfig.DOTS_API_ORIGIN + "/api/updates?after=" + after).openConnection();
            connection.setRequestProperty("Authorization", "Bearer " + token); connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
            int status = connection.getResponseCode();
            if (status == 401) { getSystemService(NotificationManager.class).notify(4101, notification(UPDATE_CHANNEL, "绒点需要你回来一下", "这个设备的登录已过期，请打开应用重新登录。", true)); stopSelf(); return; }
            if (status != 200) return;
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int n;
                while ((n = input.read(buffer)) != -1) { if (bytes.size() + n > 65536) return; bytes.write(buffer, 0, n); }
            }
            JSONObject body = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            getSharedPreferences("dots_updates", MODE_PRIVATE).edit().putLong("cursor", body.getLong("cursor")).apply();
            JSONArray updates = body.getJSONArray("updates");
            for (int i = 0; i < updates.length(); i++) {
                JSONObject update = updates.getJSONObject(i);
                String text = update.getString("kind").equals("approval") ? "有一步操作需要你授权，打开应用查看详情。" : "一项工作有了新结果，打开应用看看。";
                getSystemService(NotificationManager.class).notify(4200 + (int)(update.getLong("id") % 100), notification(UPDATE_CHANNEL, "绒绒有消息给你", text, true));
            }
        } catch (Exception ignored) {
            // Transient network failures are retried; no credentials or private payloads are logged.
        } finally { if (connection != null) connection.disconnect(); }
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() { if (executor != null) executor.shutdownNow(); super.onDestroy(); }
}
