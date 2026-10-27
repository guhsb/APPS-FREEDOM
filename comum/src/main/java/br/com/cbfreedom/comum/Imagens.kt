package br.com.cbfreedom.comum

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/**
 * Entrega para outros apps (WhatsApp, e-mail…) as imagens PNG que o app gera dos painéis.
 * Só lê arquivos da pasta cache/compartilhar do próprio app; ninguém de fora consegue listar nem gravar.
 */
class Imagens : ContentProvider() {

    companion object {
        private const val PASTA = "compartilhar"

        fun autoridade(c: Context) = c.packageName + ".imagens"

        private fun pasta(c: Context): File = File(c.cacheDir, PASTA).apply { mkdirs() }

        private fun seguro(nome: String): String =
            nome.replace(Regex("[^A-Za-z0-9À-ú._ -]"), "_").ifBlank { "Freedom.png" }.let { if (it.endsWith(".png")) it else "$it.png" }

        /** Grava a imagem e abre o "Compartilhar" do Android. */
        fun compartilhar(c: Context, dados: ByteArray, nome: String) {
            val dir = pasta(c)
            dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3600_000L) it.delete() }
            val f = File(dir, seguro(nome))
            f.writeBytes(dados)
            val uri = Uri.Builder().scheme("content").authority(autoridade(c)).appendPath(f.name).build()
            val envio = Intent(Intent.ACTION_SEND)
                .setType("image/png")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            envio.clipData = android.content.ClipData.newRawUri(f.name, uri)
            c.startActivity(Intent.createChooser(envio, "Compartilhar imagem").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }

        /** Várias páginas de uma vez: um único "Compartilhar" (WhatsApp recebe todas juntas). */
        fun compartilharVarias(c: Context, paginas: List<ByteArray>, nome: String) {
            val dir = pasta(c)
            dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3600_000L) it.delete() }
            val base = seguro(nome).removeSuffix(".png")
            val uris = ArrayList<Uri>()
            paginas.forEachIndexed { i, dados ->
                val f = File(dir, base + "_pag" + (i + 1) + ".png")
                f.writeBytes(dados)
                uris.add(Uri.Builder().scheme("content").authority(autoridade(c)).appendPath(f.name).build())
            }
            if (uris.isEmpty()) return
            val envio = Intent(Intent.ACTION_SEND_MULTIPLE)
                .setType("image/png")
                .putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val clip = android.content.ClipData.newRawUri(uris[0].lastPathSegment, uris[0])
            for (k in 1 until uris.size) clip.addItem(android.content.ClipData.Item(uris[k]))
            envio.clipData = clip
            c.startActivity(Intent.createChooser(envio, "Compartilhar " + uris.size + " imagens").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }

        /** Planilha exportada: grava e abre o "Abrir com / Compartilhar" (Excel, Drive, WhatsApp, e-mail…). */
        fun compartilharArquivo(c: Context, dados: ByteArray, nome: String, tipo: String) {
            val dir = pasta(c)
            dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3600_000L) it.delete() }
            val f = File(dir, nome.replace(Regex("[^A-Za-z0-9À-ú._ -]"), "_"))
            f.writeBytes(dados)
            val uri = Uri.Builder().scheme("content").authority(autoridade(c)).appendPath(f.name).build()
            val envio = Intent(Intent.ACTION_SEND).setType(tipo).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            envio.clipData = android.content.ClipData.newRawUri(f.name, uri)
            c.startActivity(Intent.createChooser(envio, "Abrir ou enviar a planilha").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }

        /** Arquivo vazio para a câmera gravar a foto (content://…/Foto_AAAAMMDD_HHMMSS.jpg). */
        fun novaFoto(c: Context): Pair<File, Uri> {
            val nome = "Foto_" + java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(java.util.Date()) + ".jpg"
            pasta(c).listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3600_000L) it.delete() }
            val f = File(pasta(c), nome)
            f.writeBytes(ByteArray(0))
            return Pair(f, Uri.Builder().scheme("content").authority(autoridade(c)).appendPath(f.name).build())
        }

        /** Foto muito grande: diminui para caber folgado no limite de 10 MB dos anexos. */
        fun reduzirFoto(f: File) {
            if (f.length() < 3_500_000L) return
            try {
                val o = android.graphics.BitmapFactory.Options()
                o.inSampleSize = if (f.length() > 9_000_000L) 3 else 2
                val bmp = android.graphics.BitmapFactory.decodeFile(f.absolutePath, o) ?: return
                f.outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, it) }
                bmp.recycle()
            } catch (_: Exception) { }
        }

        private fun arquivo(c: Context, uri: Uri): File? {
            val nome = uri.lastPathSegment ?: return null
            val f = File(pasta(c), nome)
            return if (f.parentFile?.canonicalPath == pasta(c).canonicalPath && f.isFile) f else null
        }
    }

    override fun onCreate() = true

    override fun getType(uri: Uri) = when {
        uri.lastPathSegment?.endsWith(".jpg") == true -> "image/jpeg"
        uri.lastPathSegment?.endsWith(".xlsx") == true -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        else -> "image/png"
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val f = arquivo(context ?: return null, uri) ?: throw java.io.FileNotFoundException(uri.toString())
        if (mode == "r") return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
        // só a foto da câmera (arquivo criado agora pelo app) pode ser gravada
        if (!f.name.startsWith("Foto_") || System.currentTimeMillis() - f.lastModified() > 30 * 60_000L) throw SecurityException("somente leitura")
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode))
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
        val f = arquivo(context ?: return null, uri) ?: return null
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val cur = MatrixCursor(cols)
        cur.addRow(cols.map { when (it) { OpenableColumns.DISPLAY_NAME -> f.name; OpenableColumns.SIZE -> f.length(); else -> null } }.toTypedArray())
        return cur
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
