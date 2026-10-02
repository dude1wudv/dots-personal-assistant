package com.microedulab.dots;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class Vault {
    private static final String ALIAS = "microedulab_dots_session";
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    static synchronized void save(Context context, String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        context.getSharedPreferences("dots_vault", Context.MODE_PRIVATE).edit()
            .putString("cipher", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).apply();
    }
    static synchronized String read(Context context) throws Exception {
        SharedPreferences prefs = context.getSharedPreferences("dots_vault", Context.MODE_PRIVATE);
        String data = prefs.getString("cipher", ""), iv = prefs.getString("iv", "");
        if (data.isEmpty() || iv.isEmpty()) return "";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
    }
    static synchronized void clear(Context context) {
        context.getSharedPreferences("dots_vault", Context.MODE_PRIVATE).edit().clear().apply();
    }
}
