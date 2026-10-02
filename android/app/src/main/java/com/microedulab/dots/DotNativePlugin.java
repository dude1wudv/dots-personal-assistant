package com.microedulab.dots;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.widget.Toast;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(name = "DotNative", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class DotNativePlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private PluginCall listeningCall;
    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private PluginCall speakingCall;

    @Override public void load() {
        getActivity().runOnUiThread(() -> {
            tts = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    int result = tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                    ttsReady = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED;
                }
            });
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { finishSpeaking(false); }
                @Override public void onError(String id) { finishSpeaking(true); }
            });
        });
    }
    private synchronized void finishSpeaking(boolean error) {
        PluginCall call = speakingCall;
        speakingCall = null;
        if (call != null) {
            if (error) call.reject("朗读失败，请检查系统语音引擎"); else call.resolve();
        }
    }
    @PluginMethod public void getToken(PluginCall call) {
        try { JSObject data = new JSObject(); data.put("token", Vault.read(getContext())); call.resolve(data); }
        catch (Exception error) { Vault.clear(getContext()); JSObject data = new JSObject(); data.put("token", ""); call.resolve(data); }
    }
    @PluginMethod public void setToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token.length() < 32 || token.length() > 256) { call.reject("无效会话"); return; }
        try { Vault.save(getContext(), token); call.resolve(); } catch (Exception error) { call.reject("安全会话保存失败"); }
    }
    @PluginMethod public void clearToken(PluginCall call) {
        Vault.clear(getContext());
        getContext().stopService(new Intent(getContext(), DotBackgroundService.class));
        call.resolve();
    }
    @PluginMethod public void listen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) requestPermissionForAlias("microphone", call, "microphoneGranted");
        else startListening(call);
    }
    @PermissionCallback private void microphoneGranted(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("请允许麦克风权限，或继续使用文字输入"); return; }
        startListening(call);
    }
    private void startListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (listeningCall != null) { call.reject("正在聆听，请稍候"); return; }
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("系统未安装语音识别服务，请在系统设置中启用语音输入"); return; }
            listeningCall = call;
            if (recognizer != null) recognizer.destroy();
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle params) {}
                public void onBeginningOfSpeech() {}
                public void onRmsChanged(float rms) {}
                public void onBufferReceived(byte[] buffer) {}
                public void onEndOfSpeech() {}
                public void onPartialResults(Bundle results) {}
                public void onEvent(int type, Bundle params) {}
                public void onError(int error) {
                    PluginCall active = listeningCall; listeningCall = null;
                    if (active != null) active.reject(error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "没有听清，点麦克风再说一次" : "系统语音识别暂不可用（" + error + "），可继续文字输入");
                }
                public void onResults(Bundle results) {
                    PluginCall active = listeningCall; listeningCall = null;
                    ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (active == null) return;
                    if (texts == null || texts.isEmpty()) active.reject("没有识别到语音，请再试一次");
                    else { JSObject data = new JSObject(); data.put("text", texts.get(0)); active.resolve(data); }
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizer.startListening(intent);
        });
    }
    @PluginMethod public void speak(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!ttsReady || tts == null) { call.reject("中文朗读引擎未就绪，请检查系统文字转语音设置"); return; }
            String text = call.getString("text", "");
            if (text.isEmpty()) { call.resolve(); return; }
            finishSpeaking(false); speakingCall = call;
            if (tts.speak(text.substring(0, Math.min(text.length(), TextToSpeech.getMaxSpeechInputLength())), TextToSpeech.QUEUE_FLUSH, null, "dots-" + System.nanoTime()) == TextToSpeech.ERROR) finishSpeaking(true);
        });
    }
    @PluginMethod public void stopSpeaking(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (tts != null) tts.stop(); finishSpeaking(false); call.resolve(); });
    }
    @PluginMethod public void hideKeyboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager) getActivity().getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(getBridge().getWebView().getWindowToken(), 0);
            getBridge().getWebView().clearFocus();
            call.resolve();
        });
    }
    @PluginMethod public void background(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (enabled && Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsGranted"); return;
        }
        setBackground(call, enabled);
    }
    @PermissionCallback private void notificationsGranted(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) { call.reject("请允许通知权限，才能收到后台提醒"); return; }
        setBackground(call, true);
    }
    private void setBackground(PluginCall call, boolean enabled) {
        Intent intent = new Intent(getContext(), DotBackgroundService.class);
        if (enabled) ContextCompat.startForegroundService(getContext(), intent); else getContext().stopService(intent);
        call.resolve();
    }
    @PluginMethod public void saveFile(PluginCall call) {
        getBridge().execute(() -> {
            Uri uri = null;
            try {
                String name = call.getString("name", "dots-file").replaceAll("[\\\\/:*?\"<>|]", "_");
                String encoded = call.getString("data", "");
                if (encoded.length() > 45 * 1024 * 1024) { call.reject("文件超过下载上限"); return; }
                byte[] content = Base64.decode(encoded, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.DISPLAY_NAME, name); values.put(MediaStore.Downloads.MIME_TYPE, call.getString("mime", "application/octet-stream")); values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/绒点"); values.put(MediaStore.Downloads.IS_PENDING, 1);
                    uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new IllegalStateException();
                    try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) { if (output == null) throw new IllegalStateException(); output.write(content); }
                    values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0); getContext().getContentResolver().update(uri, values, null, null);
                } else {
                    File file = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name);
                    try (FileOutputStream output = new FileOutputStream(file)) { output.write(content); }
                    uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                }
                JSObject result = new JSObject(); result.put("uri", uri.toString()); call.resolve(result);
                getActivity().runOnUiThread(() -> Toast.makeText(getContext(), "已保存到下载 / 绒点", Toast.LENGTH_LONG).show());
            } catch (Exception error) {
                if (uri != null && Build.VERSION.SDK_INT >= 29) getContext().getContentResolver().delete(uri, null, null);
                call.reject("文件保存失败，请检查存储空间");
            }
        });
    }
    @Override protected void handleOnDestroy() {
        if (recognizer != null) recognizer.destroy();
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (listeningCall != null) { listeningCall.reject("语音输入已关闭"); listeningCall = null; }
        finishSpeaking(false);
    }
}
