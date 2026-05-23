package com.embedimage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

// Decodes the source (PNG/JPEG/BMP/GIF/WEBP), applies brightness +
// contrast (linear), gamma (per-channel LUT), and a final white-tint
// overlay that preserves alpha, then writes a PNG to the app cache.
// PluginNoteAPI.insertImage is PNG-only, so we always emit PNG.
class ImageProcessorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ImageProcessor"

    @ReactMethod
    fun processForEmbed(
        inputPath: String,
        whiteAlpha: Double,
        brightness: Int,
        contrast: Int,
        gamma: Double,
        previewMaxDim: Int,
        promise: Promise,
    ) {
        var src: Bitmap? = null
        try {
            val decodeOpts = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            if (previewMaxDim > 0) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(inputPath, bounds)
                val maxSide = max(bounds.outWidth, bounds.outHeight)
                if (maxSide > 0) {
                    var sample = 1
                    while (maxSide / (sample * 2) >= previewMaxDim) sample *= 2
                    decodeOpts.inSampleSize = sample
                }
            }
            src = BitmapFactory.decodeFile(inputPath, decodeOpts)
                ?: throw RuntimeException("decode failed: $inputPath")

            val w = src.width
            val h = src.height
            val pixels = IntArray(w * h)
            src.getPixels(pixels, 0, w, 0, 0, w, h)

            // Pre-compute gamma LUT.
            val g = if (gamma <= 0.0) 1.0 else gamma
            val invG = 1.0 / g
            val gammaLut = IntArray(256)
            for (i in 0..255) {
                gammaLut[i] = (255.0 * (i / 255.0).pow(invG)).toInt().coerceIn(0, 255)
            }

            // contrast: -100..100 → factor 0..2 around midpoint 128.
            val contrastFactor = ((contrast.coerceIn(-100, 100) + 100).toDouble()) / 100.0
            val brightnessAdjust = brightness.coerceIn(-100, 100)

            val wa = (whiteAlpha.coerceIn(0.0, 1.0) * 255).toInt()
            val invWa = 255 - wa

            for (i in pixels.indices) {
                val p = pixels[i]
                val a = (p ushr 24) and 0xFF
                if (a == 0) continue
                var r = (p ushr 16) and 0xFF
                var gC = (p ushr 8) and 0xFF
                var b = p and 0xFF

                r = applyBC(r, contrastFactor, brightnessAdjust)
                gC = applyBC(gC, contrastFactor, brightnessAdjust)
                b = applyBC(b, contrastFactor, brightnessAdjust)

                r = gammaLut[r]
                gC = gammaLut[gC]
                b = gammaLut[b]

                if (wa > 0) {
                    r = (r * invWa + 255 * wa) / 255
                    gC = (gC * invWa + 255 * wa) / 255
                    b = (b * invWa + 255 * wa) / 255
                }

                pixels[i] = (a shl 24) or (r shl 16) or (gC shl 8) or b
            }

            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            out.setPixels(pixels, 0, w, 0, 0, w, h)

            val tag = if (previewMaxDim > 0) "prev" else "embed"
            val outFile = File(reactApplicationContext.cacheDir, "${tag}_${System.currentTimeMillis()}.png")
            FileOutputStream(outFile).use { stream ->
                out.compress(Bitmap.CompressFormat.PNG, 100, stream)
            }
            out.recycle()
            promise.resolve(outFile.absolutePath)
        } catch (e: Throwable) {
            promise.reject("E_PROCESS", e.message ?: e.toString(), e)
        } finally {
            src?.recycle()
        }
    }

    private fun applyBC(channel: Int, contrastFactor: Double, brightnessAdjust: Int): Int {
        val v = ((channel - 128) * contrastFactor + 128 + brightnessAdjust).toInt()
        return min(255, max(0, v))
    }

    // Deletes prev_*.png / embed_*.png left over from previous sessions so
    // the cache doesn't grow unbounded across launches.
    @ReactMethod
    fun cleanupCache(promise: Promise) {
        try {
            val dir = reactApplicationContext.cacheDir
            var n = 0
            dir.listFiles()?.forEach { f ->
                val name = f.name
                if ((name.startsWith("prev_") || name.startsWith("embed_")) && name.endsWith(".png")) {
                    if (f.delete()) n++
                }
            }
            promise.resolve(n)
        } catch (e: Throwable) {
            promise.reject("E_CLEANUP", e.message ?: e.toString(), e)
        }
    }
}
