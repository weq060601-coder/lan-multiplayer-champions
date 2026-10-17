package com.pokerogue.multiplayer;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate() 之前锁横屏：
        // BridgeActivity.onCreate() 内部就会创建并首次布局 WebView。
        // 如果此刻窗口还是竖屏，Android 5.1 的旧 WebView 会把竖屏 viewport 缓存下来，
        // 之后窗口转成横屏也不保证重新测量，Phaser 的 Scale.FIT 就按竖屏比例算，画面被压扁。
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        // 局域网主机自动发现插件（UDP 广播，对端是电脑上的 scripts/lan-discovery.mjs）。
        // ⚠️ 必须在 super.onCreate() 之前注册：BridgeActivity.onCreate() 末尾就会调 load()，
        //    那里 bridgeBuilder 的插件列表已经定型，之后再注册无效（插件在 JS 侧直接不存在）。
        // 注：cap sync 生成的 capacitor.plugins.json 是空数组 —— 它只收集 npm 包里的插件，
        //    app 内自写的 Java 类必须像这样手动注册。好处是 cap sync 不会冲掉这行。
        registerPlugin(LanDiscoveryPlugin.class);
        // 安卓端自托管 PeerJS 信令；开始创建房间时启动，局域网其他手机通过 UDP 搜索发现。
        registerPlugin(LanSignalServerPlugin.class);

        super.onCreate(savedInstanceState);

        applyImmersiveMode();
    }

    /** 沉浸式全屏：隐藏顶部状态栏与底部虚拟导航键 */
    private void applyImmersiveMode() {
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }

    /**
     * 系统会在窗口失去焦点时清掉 IMMERSIVE_STICKY 标志位。
     * 联机大厅用 JS prompt() 输房间码，弹框就会失焦，
     * 回来后状态栏/导航键会赖着不走并挤压 WebView 尺寸，所以每次拿回焦点都重新应用一次。
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }
}
