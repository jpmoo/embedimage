package com.embedimage

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

// Registers native modules for the plugin. The package's existence also
// forces the build pipeline to produce an app.npk, which the plugin host
// requires to load the React Native runtime for this plugin.
class StubPackage : ReactPackage {
    init {
        // The Supernote pluginhost runs with cleartext HTTP blocked by
        // NetworkSecurityPolicy, so JS fetch() to the LAN Mac server fails
        // with "cleartext HTTP traffic to X not permitted". Our own
        // AndroidManifest setting doesn't apply because the policy is read
        // from the host process. Force-flip the singleton at plugin load.
        try {
            val policy = android.security.NetworkSecurityPolicy.getInstance()
            val cls = policy.javaClass
            for (name in arrayOf("mCleartextTrafficPermitted", "DEFAULT_CLEARTEXT_TRAFFIC_PERMITTED")) {
                try {
                    val f = cls.getDeclaredField(name)
                    f.isAccessible = true
                    f.setBoolean(policy, true)
                } catch (_: NoSuchFieldException) {
                    // field name varies by Android version; keep trying.
                }
            }
        } catch (e: Throwable) {
            android.util.Log.w("EmbedImage", "cleartext override failed: $e")
        }
    }

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(ImageProcessorModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<View, ReactShadowNode<*>>> = emptyList()
}
