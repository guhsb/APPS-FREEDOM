package br.com.cbfreedom.comum

import android.app.DownloadManager
import android.app.Notification
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.MimeTypeMap
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Salva na pasta Downloads os arquivos que o site gera (relatórios, anexos). */
object Arquivos {

    fun nome(nome: String?, mime: String): String {
        var n = nome?.trim().orEmpty()
        if (n.isEmpty()) {
            val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
            n = "Freedom_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + (if (ext != null) ".$ext" else "")
        }
        return n.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    }

    /** "data:tipo;base64,...." vindo do site. */
    fun salvarDataUrl(c: Context, dataUrl: String, nomeSugerido: String?): Boolean {
        val virgula = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:") || virgula < 0) return false
        val cab = dataUrl.substring(5, virgula)
        val mime = cab.substringBefore(';').ifEmpty { "application/octet-stream" }
        val dados = if (cab.endsWith(";base64")) Base64.decode(dataUrl.substring(virgula + 1), Base64.DEFAULT)
        else Uri.decode(dataUrl.substring(virgula + 1)).toByteArray(Charsets.UTF_8)
        return salvar(c, dados, nome(nomeSugerido, mime), mime)
    }

    fun salvar(c: Context, dados: ByteArray, nome: String, mime: String): Boolean {
        if (Build.VERSION.SDK_INT >= 29) {
            val cr = c.contentResolver
            val v = ContentValues()
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, nome)
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime)
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/")
            v.put(MediaStore.MediaColumns.IS_PENDING, 1)
            val uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: return false
            cr.openOutputStream(uri)?.use { it.write(dados) } ?: return false
            v.clear()
            v.put(MediaStore.MediaColumns.IS_PENDING, 0)
            cr.update(uri, v, null, null)
            avisar(c, nome, uri, mime)
            return true
        }
        val pasta = c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return false
        pasta.mkdirs()
        var f = File(pasta, nome)
        var i = 1
        while (f.exists()) {
            val base = nome.substringBeforeLast('.', nome)
            val ext = if (nome.contains('.')) "." + nome.substringAfterLast('.') else ""
            f = File(pasta, "$base (${i++})$ext")
        }
        f.writeBytes(dados)
        @Suppress("DEPRECATION")
        (c.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager)
            .addCompletedDownload(f.name, "Freedom", true, mime, f.absolutePath, f.length(), true)
        return true
    }

    /** Imagem gerada pelo app: vai para a Galeria (Imagens/Freedom). Android antigo: pasta Downloads do app. */
    fun salvarImagem(c: Context, dados: ByteArray, nome: String): String? {
        if (Build.VERSION.SDK_INT >= 29) {
            val cr = c.contentResolver
            val v = ContentValues()
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, nome)
            v.put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Freedom/")
            v.put(MediaStore.MediaColumns.IS_PENDING, 1)
            val uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v) ?: return null
            cr.openOutputStream(uri)?.use { it.write(dados) } ?: return null
            v.clear()
            v.put(MediaStore.MediaColumns.IS_PENDING, 0)
            cr.update(uri, v, null, null)
            return "Galeria › Freedom"
        }
        return if (salvar(c, dados, nome, "image/png")) "Downloads" else null
    }

    private fun avisar(c: Context, nome: String, uri: Uri, mime: String) {
        Helpdesk.criarCanais(c)
        val ver = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        val id = 90_000 + (System.currentTimeMillis() % 9_000).toInt()
        val pi = PendingIntent.getActivity(c, id, Intent.createChooser(ver, "Abrir com"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(c, Helpdesk.CANAL_SISTEMA)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Download concluído")
            .setContentText("$nome · pasta Downloads")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        try { Helpdesk.nm(c).notify(id, n) } catch (_: Exception) { }
    }
}
