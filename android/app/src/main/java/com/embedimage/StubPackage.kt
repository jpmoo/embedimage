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
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(ImageProcessorModule(reactContext))
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<View, ReactShadowNode<*>>> = emptyList()
}
