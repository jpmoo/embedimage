package com.embedimage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

// Bakes a white-tint overlay into the source bitmap and writes a PNG to the
// app cache. Used to (a) fade an image toward white for reference tracing on
// e-ink and (b) convert JPEGs to PNG since PluginNoteAPI.insertImage is
// PNG-only.
class ImageProcessorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ImageProcessor"

    @ReactMethod
    fun processForEmbed(inputPath: String, whiteAlpha: Double, promise: Promise) {
        var src: Bitmap? = null
        var out: Bitmap? = null
        try {
            val options = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            src = BitmapFactory.decodeFile(inputPath, options)
                ?: throw RuntimeException("decode failed: $inputPath")

            out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(out)
            canvas.drawBitmap(src, 0f, 0f, null)

            val clamped = whiteAlpha.coerceIn(0.0, 1.0)
            if (clamped > 0.0) {
                val alpha = (clamped * 255).toInt().coerceIn(0, 255)
                // SRC_ATOP keeps the source alpha channel — transparent regions
                // stay transparent instead of being filled with white.
                val paint = Paint().apply {
                    color = Color.argb(alpha, 255, 255, 255)
                    xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP)
                }
                canvas.drawRect(0f, 0f, out.width.toFloat(), out.height.toFloat(), paint)
            }

            val outFile = File(reactApplicationContext.cacheDir, "embed_${System.currentTimeMillis()}.png")
            FileOutputStream(outFile).use { stream ->
                out.compress(Bitmap.CompressFormat.PNG, 100, stream)
            }
            promise.resolve(outFile.absolutePath)
        } catch (e: Throwable) {
            promise.reject("E_PROCESS", e.message ?: e.toString(), e)
        } finally {
            src?.recycle()
            out?.recycle()
        }
    }
}
