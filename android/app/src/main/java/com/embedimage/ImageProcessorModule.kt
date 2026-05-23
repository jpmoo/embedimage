package com.embedimage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
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
            // Raw-socket HTTP bypasses Android's NetworkSecurityPolicy, which
            // blocks cleartext to LAN IPs inside the Supernote pluginhost.
            val (status, body) = rawHttpRequest("GET", url, null, null, timeoutMs)
            if (status !in 200..299) {
                throw RuntimeException("HTTP $status")
            }
            dlFile = File(reactApplicationContext.cacheDir, "dl_${System.currentTimeMillis()}.bin")
            FileOutputStream(dlFile).use { it.write(body) }
            val outPath = bake(dlFile.absolutePath, whiteAlpha, brightness, contrast, gamma, previewMaxDim)
            promise.resolve(outPath)
        } catch (e: Throwable) {
            promise.reject("E_DOWNLOAD", e.message ?: e.toString(), e)
        } finally {
            dlFile?.delete()
        }
    }

    // Cleartext-safe HTTP fetch used by JS for small JSON endpoints
    // (/status, /adjust). Returns {status:int, body:string}. Body is decoded
    // as UTF-8; for binary payloads use downloadAndProcess.
    // POST the contents of `inputPath` as the request body to `url`, write
    // the binary response to a temp file in the cache dir, and resolve
    // with that path. Used for BiRefNet (PNG in, PNG out) where lanHttp
    // would corrupt the response by decoding it as UTF-8 text.
    @ReactMethod
    fun nativeHttpPostFile(
        url: String,
        inputPath: String,
        contentType: String,
        timeoutMs: Int,
        promise: Promise,
    ) {
        try {
            val src = File(inputPath)
            if (!src.exists()) {
                promise.reject("E_HTTP_FILE", "input file does not exist: $inputPath")
                return
            }
            val body = src.readBytes()
            val (status, raw) = rawHttpRequest("POST", url, body, contentType, timeoutMs)
            if (status !in 200..299) {
                promise.reject("E_HTTP", "HTTP $status — ${String(raw, Charsets.UTF_8).take(200)}")
                return
            }
            val outFile = File(reactApplicationContext.cacheDir, "bgr_${System.currentTimeMillis()}.png")
            FileOutputStream(outFile).use { it.write(raw) }
            promise.resolve(outFile.absolutePath)
        } catch (e: Throwable) {
            promise.reject("E_HTTP_FILE", e.message ?: e.toString(), e)
        }
    }

    @ReactMethod
    fun nativeHttp(
        method: String,
        url: String,
        bodyJson: String?,
        timeoutMs: Int,
        promise: Promise,
    ) {
        try {
            val (status, raw) = rawHttpRequest(
                method.uppercase(),
                url,
                if (bodyJson.isNullOrEmpty()) null else bodyJson.toByteArray(Charsets.UTF_8),
                if (bodyJson.isNullOrEmpty()) null else "application/json; charset=utf-8",
                timeoutMs,
            )
            val result: WritableMap = Arguments.createMap()
            result.putInt("status", status)
            result.putString("body", String(raw, Charsets.UTF_8))
            promise.resolve(result)
        } catch (e: Throwable) {
            promise.reject("E_HTTP", e.message ?: e.toString(), e)
        }
    }

    private fun rawHttpRequest(
        method: String,
        url: String,
        body: ByteArray?,
        contentType: String?,
        timeoutMs: Int,
    ): Pair<Int, ByteArray> {
        val u = URL(url)
        require(u.protocol.equals("http", ignoreCase = true)) { "only http:// supported" }
        val host = u.host
        val port = if (u.port == -1) 80 else u.port
        val path = (u.path.ifEmpty { "/" }) + (if (u.query != null) "?" + u.query else "")

        Socket().use { sock ->
            sock.connect(InetSocketAddress(host, port), timeoutMs)
            sock.soTimeout = timeoutMs

            val out: OutputStream = sock.getOutputStream()
            val req = StringBuilder()
            req.append("$method $path HTTP/1.1\r\n")
            req.append("Host: $host${if (port == 80) "" else ":$port"}\r\n")
            req.append("Connection: close\r\n")
            req.append("Accept-Encoding: identity\r\n")
            req.append("User-Agent: EmbedImage/1\r\n")
            if (body != null) {
                req.append("Content-Type: ${contentType ?: "application/octet-stream"}\r\n")
                req.append("Content-Length: ${body.size}\r\n")
            }
            req.append("\r\n")
            out.write(req.toString().toByteArray(Charsets.US_ASCII))
            if (body != null) out.write(body)
            out.flush()

            val inp: InputStream = sock.getInputStream()
            val all = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            while (true) {
                val n = inp.read(buf)
                if (n <= 0) break
                all.write(buf, 0, n)
            }
            val raw = all.toByteArray()
            val sep = indexOfDoubleCRLF(raw)
                ?: throw RuntimeException("malformed HTTP response (no header terminator)")
            val headerStr = String(raw, 0, sep, Charsets.US_ASCII)
            var bodyBytes = raw.copyOfRange(sep + 4, raw.size)

            val lines = headerStr.split("\r\n")
            val statusLine = lines.firstOrNull() ?: throw RuntimeException("empty HTTP response")
            val statusParts = statusLine.split(" ", limit = 3)
            if (statusParts.size < 2) throw RuntimeException("bad status line: $statusLine")
            val status = statusParts[1].toIntOrNull()
                ?: throw RuntimeException("bad status code: ${statusParts[1]}")

            val isChunked = lines.drop(1).any {
                val ix = it.indexOf(':')
                if (ix < 0) false
                else it.substring(0, ix).trim().equals("Transfer-Encoding", ignoreCase = true)
                    && it.substring(ix + 1).trim().contains("chunked", ignoreCase = true)
            }
            if (isChunked) bodyBytes = decodeChunked(bodyBytes)
            return status to bodyBytes
        }
    }

    private fun indexOfDoubleCRLF(data: ByteArray): Int? {
        var i = 0
        while (i <= data.size - 4) {
            if (data[i] == 0x0D.toByte() && data[i + 1] == 0x0A.toByte()
                && data[i + 2] == 0x0D.toByte() && data[i + 3] == 0x0A.toByte()
            ) return i
            i++
        }
        return null
    }

    private fun decodeChunked(input: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < input.size) {
            var j = i
            while (j < input.size - 1 && !(input[j] == 0x0D.toByte() && input[j + 1] == 0x0A.toByte())) j++
            if (j >= input.size - 1) break
            val sizeLine = String(input, i, j - i, Charsets.US_ASCII).substringBefore(';').trim()
            val size = sizeLine.toIntOrNull(16) ?: break
            i = j + 2
            if (size == 0) break
            if (i + size > input.size) break
            out.write(input, i, size)
            i += size + 2
        }
        return out.toByteArray()
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

    // Inkling-style file logger. Creates parent dirs on demand; appends
    // UTF-8 with a trailing newline. Best-effort: callers should swallow
    // failures (e.g. when /sdcard isn't writable on a locked device).
    @ReactMethod
    fun appendFile(path: String, text: String, promise: Promise) {
        try {
            val f = File(path)
            f.parentFile?.mkdirs()
            FileOutputStream(f, true).use { it.write((text + "\n").toByteArray(Charsets.UTF_8)) }
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject("E_APPEND", e.message ?: e.toString(), e)
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
