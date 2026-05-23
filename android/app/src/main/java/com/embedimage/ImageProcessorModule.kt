package com.embedimage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

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
        try {
            val outPath = bake(inputPath, whiteAlpha, brightness, contrast, gamma, previewMaxDim)
            promise.resolve(outPath)
        } catch (e: Throwable) {
            promise.reject("E_PROCESS", e.message ?: e.toString(), e)
        }
    }

    // Fetch a URL, write the body to cache, run the same bake pipeline, return
    // the baked PNG path. Used by the live-capture screen so the streaming
    // pipeline is one native call per frame instead of fetch-in-JS + bake.
    @ReactMethod
    fun downloadAndProcess(
        url: String,
        whiteAlpha: Double,
        brightness: Int,
        contrast: Int,
        gamma: Double,
        previewMaxDim: Int,
        timeoutMs: Int,
        promise: Promise,
    ) {
        var dlFile: File? = null
        try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.requestMethod = "GET"
            conn.doInput = true
            val code = conn.responseCode
            if (code !in 200..299) {
                throw RuntimeException("HTTP $code")
            }
            dlFile = File(reactApplicationContext.cacheDir, "dl_${System.currentTimeMillis()}.bin")
            conn.inputStream.use { input ->
                FileOutputStream(dlFile).use { out -> input.copyTo(out) }
            }
            val outPath = bake(dlFile.absolutePath, whiteAlpha, brightness, contrast, gamma, previewMaxDim)
            promise.resolve(outPath)
        } catch (e: Throwable) {
            promise.reject("E_DOWNLOAD", e.message ?: e.toString(), e)
        } finally {
            dlFile?.delete()
        }
    }

    private fun bake(
        inputPath: String,
        whiteAlpha: Double,
        brightness: Int,
        contrast: Int,
        gamma: Double,
        previewMaxDim: Int,
    ): String {
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

            val isIdentity = whiteAlpha <= 0.0
                && brightness == 0
                && contrast == 0
                && kotlin.math.abs(gamma - 1.0) < 1e-6

            val tag = if (previewMaxDim > 0) "prev" else "embed"
            val outFile = File(reactApplicationContext.cacheDir, "${tag}_${System.currentTimeMillis()}.png")

            if (isIdentity) {
                // Identity adjustments — skip the per-pixel loop. Saves real
                // CPU on Manta when the Mac server already baked the look in.
                FileOutputStream(outFile).use { stream ->
                    src.compress(Bitmap.CompressFormat.PNG, 100, stream)
                }
                return outFile.absolutePath
            }

            val pixels = IntArray(w * h)
            src.getPixels(pixels, 0, w, 0, 0, w, h)

            val g = if (gamma <= 0.0) 1.0 else gamma
            val invG = 1.0 / g
            val gammaLut = IntArray(256)
            for (i in 0..255) {
                gammaLut[i] = (255.0 * (i / 255.0).pow(invG)).toInt().coerceIn(0, 255)
            }

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

            FileOutputStream(outFile).use { stream ->
                out.compress(Bitmap.CompressFormat.PNG, 100, stream)
            }
            out.recycle()
            return outFile.absolutePath
        } finally {
            src?.recycle()
        }
    }

    private fun applyBC(channel: Int, contrastFactor: Double, brightnessAdjust: Int): Int {
        val v = ((channel - 128) * contrastFactor + 128 + brightnessAdjust).toInt()
        return min(255, max(0, v))
    }

    @ReactMethod
    fun cleanupCache(promise: Promise) {
        try {
            val dir = reactApplicationContext.cacheDir
            var n = 0
            dir.listFiles()?.forEach { f ->
                val name = f.name
                if ((name.startsWith("prev_") || name.startsWith("embed_") || name.startsWith("dl_")) &&
                    (name.endsWith(".png") || name.endsWith(".bin"))) {
                    if (f.delete()) n++
                }
            }
            promise.resolve(n)
        } catch (e: Throwable) {
            promise.reject("E_CLEANUP", e.message ?: e.toString(), e)
        }
    }

    // Persistent key/value config backed by SharedPreferences. The plugin's
    // settings screen serializes its config as JSON under a single key.
    private val prefs by lazy {
        reactApplicationContext.getSharedPreferences("embedimage_prefs", android.content.Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun getConfigValue(key: String, promise: Promise) {
        try {
            promise.resolve(prefs.getString(key, null))
        } catch (e: Throwable) {
            promise.reject("E_CONFIG", e.message ?: e.toString(), e)
        }
    }

    @ReactMethod
    fun setConfigValue(key: String, value: String?, promise: Promise) {
        try {
            val editor = prefs.edit()
            if (value == null) editor.remove(key) else editor.putString(key, value)
            editor.apply()
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject("E_CONFIG", e.message ?: e.toString(), e)
        }
    }
}
