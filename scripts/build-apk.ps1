param(
    # 只想重打包、不想重新编译前端时加上它（例如只改了 gradle 配置）
    [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"

# 脚本在副本 scripts/ 下，上一级就是当前项目根。不要再写死 G:\ 源仓库。
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$androidDir = Join-Path $repoRoot "android"
$sdkDir = "$env:LOCALAPPDATA\Android\Sdk"
$jdkDir = "H:\anzhuo\jbr"

Write-Host "========================================"
Write-Host "  PokeRogue Android APK Build"
Write-Host "========================================"

$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$env:JAVA_HOME = $jdkDir
$env:PATH = "$jdkDir\bin;$env:PATH"

# ⚠️ 这两步以前漏了，导致「改了源码、编了 APK、装上去还是旧的」白绕好几轮。
#    APK 里的网页内容来自 android/app/src/main/assets/public，
#    那份东西只有 cap sync 会从 dist/ 拷过去 —— gradle 自己不管这事。
#    所以顺序必须是：npm run build -> cap sync -> gradle。
if ($SkipWebBuild) {
    Write-Host "[1/3] Skipping npm run build (-SkipWebBuild). 用现成的 dist/。"
} else {
    Write-Host ""
    Write-Host "[1/3] Building app web bundle (npm run build:app)..."
    Set-Location $repoRoot
    $env:NODE_OPTIONS = "--max-old-space-size=3072"
    & npm run build:app
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm run build:app failed. 如果报 EPERM on dist\assets，先关掉 launcher（双击启动游戏.bat 那个窗口）再重来。"
        exit 1
    }
}

# ⚠️ cap sync 绝对不能跟着 -SkipWebBuild 一起跳过。
#    它是唯一把 dist/ 拷进 android/app/src/main/assets/public 的一步，
#    漏掉它就会「改了源码、编了 APK、装上去还是旧的」—— 之前白绕好几轮就是这个原因。
#    它只读 dist、只写 android/，所以 launcher 开着也不影响。
Write-Host ""
Write-Host "[2/3] Syncing web bundle into android project (cap sync)..."
Set-Location $repoRoot
& "$repoRoot\node_modules\.bin\cap.cmd" sync android
if ($LASTEXITCODE -ne 0) { Write-Error "cap sync failed."; exit 1 }

# 自动确保所有 gradle 脚本使用本机 JDK 17。
# Capacitor 8 的 Java 21 写在 node_modules 里，只扫 android/ 会漏掉。
$gradleRoots = @($androidDir, (Join-Path $repoRoot "node_modules\@capacitor"))
Get-ChildItem -Path $gradleRoots -Recurse -Filter "*.gradle" -File -ErrorAction SilentlyContinue | ForEach-Object {
    $txt = [System.IO.File]::ReadAllText($_.FullName)
    if ($txt.Contains("JavaVersion.VERSION_21")) {
        $txt = $txt.Replace("JavaVersion.VERSION_21", "JavaVersion.VERSION_17")
        [System.IO.File]::WriteAllText($_.FullName, $txt, [System.Text.Encoding]::ASCII)
    }
}

Write-Host "JDK: $env:JAVA_HOME"
Write-Host "SDK: $env:ANDROID_HOME"

Set-Location $androidDir

Write-Host ""
Write-Host "[3/3] Running Gradle assembleDebug..."
# --no-daemon：打完包 JVM 直接退出，不在后台留一个占 ~2GB 内存、闲置 3 小时才退出的 Gradle 守护进程。
& "$androidDir\gradlew.bat" assembleDebug --no-daemon
if ($LASTEXITCODE -ne 0) { Write-Error "Gradle build failed."; exit 1 }

$apkSrc = "$androidDir\app\build\outputs\apk\debug\app-debug.apk"
$apkDest = Join-Path $repoRoot "PokeRogue-LAN-Multiplayer.apk"

if (Test-Path $apkSrc) {
    Copy-Item -Path $apkSrc -Destination $apkDest -Force
    Write-Host ""
    Write-Host "================================================================"
    Write-Host "  APK Build Complete!"
    Write-Host "  Output: $apkDest"
    Write-Host "  Size: $([math]::Round((Get-Item $apkDest).Length / 1MB, 2)) MB"
    Write-Host "================================================================"
} else {
    Write-Error "APK file not found after build."
}
