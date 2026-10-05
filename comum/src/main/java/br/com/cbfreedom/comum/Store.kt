package br.com.cbfreedom.comum

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Guarda o login (senha criptografada pelo cofre do Android) e os últimos números baixados. */
object Store {

    private const val ALIAS = "freedom_login"

    private fun prefs(c: Context): SharedPreferences = c.getSharedPreferences("login", Context.MODE_PRIVATE)
    fun cache(c: Context): SharedPreferences = c.getSharedPreferences("cache", Context.MODE_PRIVATE)

    private fun chave(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore")
        ks.load(null)
        val existente = ks.getKey(ALIAS, null)
        if (existente is SecretKey) return existente
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return g.generateKey()
    }

    private fun b64(b: ByteArray): String = Base64.encodeToString(b, Base64.NO_WRAP)

    private fun cifrar(t: String): String = try {
        val ci = Cipher.getInstance("AES/GCM/NoPadding")
        ci.init(Cipher.ENCRYPT_MODE, chave())
        val dados = ci.doFinal(t.toByteArray(Charsets.UTF_8))
        "k:" + b64(ci.iv) + ":" + b64(dados)
    } catch (_: Exception) {
        // aparelho sem cofre funcionando: fica só dentro do app (outros apps não leem)
        "p:" + b64(t.toByteArray(Charsets.UTF_8))
    }

    private fun decifrar(s: String): String? = try {
        when {
            s.startsWith("k:") -> {
                val partes = s.split(":")
                val ci = Cipher.getInstance("AES/GCM/NoPadding")
                ci.init(Cipher.DECRYPT_MODE, chave(), GCMParameterSpec(128, Base64.decode(partes[1], Base64.NO_WRAP)))
                String(ci.doFinal(Base64.decode(partes[2], Base64.NO_WRAP)), Charsets.UTF_8)
            }
            s.startsWith("p:") -> String(Base64.decode(s.substring(2), Base64.NO_WRAP), Charsets.UTF_8)
            else -> null
        }
    } catch (_: Exception) { null }

    fun salvarLogin(c: Context, email: String, senha: String) {
        prefs(c).edit().putString("email", email).putString("senha", cifrar(senha)).apply()
    }

    fun email(c: Context): String? = prefs(c).getString("email", null)

    fun login(c: Context): Pair<String, String>? {
        val p = prefs(c)
        val e = p.getString("email", null) ?: return null
        val s = decifrar(p.getString("senha", null) ?: return null) ?: return null
        return Pair(e, s)
    }

    fun logado(c: Context): Boolean = prefs(c).getString("senha", null) != null

    fun sair(c: Context) {
        prefs(c).edit().clear().apply()
        cache(c).edit().clear().apply()
    }
}
