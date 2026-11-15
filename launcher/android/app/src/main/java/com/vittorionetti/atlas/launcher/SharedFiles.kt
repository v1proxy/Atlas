package com.vittorionetti.atlas.launcher

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileNotFoundException

/**
 * Files fetched from Atlas for another app: holding a file (open it in its app) and Share. Each one waits in this app's
 * cache, cache/open/<key>/<name>, and is handed over as content://com.vittorionetti.atlas.launcher.files/<key>/<name>:
 * only the app it was given to can read it, and only while it holds it. Nothing else here can be reached. A day
 * later the copy is deleted.
 */
class SharedFiles : ContentProvider() {
    companion object {
        const val AUTHORITY = "com.vittorionetti.atlas.launcher.files"
        fun dir(c: Context) = File(c.cacheDir, "open")
        fun uri(f: File): Uri = Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(f.parentFile!!.name).appendPath(f.name).build()
        fun mime(name: String): String =
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
    }

    override fun onCreate() = true

    private fun file(uri: Uri): File {
        val seg = uri.pathSegments
        if (seg.size != 2) throw FileNotFoundException()
        val root = dir(context!!).canonicalFile
        val f = File(File(root, seg[0]), seg[1]).canonicalFile
        if (f.parentFile?.parentFile != root || !f.isFile) throw FileNotFoundException()
        return f
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("read only")
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String = mime(uri.lastPathSegment ?: "")

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        val f = file(uri)
        val cols = projection?.filter { it == OpenableColumns.DISPLAY_NAME || it == OpenableColumns.SIZE }?.toTypedArray()
            ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(cols, 1).apply { addRow(cols.map { if (it == OpenableColumns.SIZE) f.length() else f.name }) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
