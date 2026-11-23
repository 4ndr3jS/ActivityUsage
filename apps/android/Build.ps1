[CmdletBinding()]
param(
    [string]$AndroidSdk = $env:ANDROID_HOME,
    [string]$Jdk = $env:JAVA_HOME,
    [string]$BuildTools
)

$ErrorActionPreference = 'Stop'
if (-not $AndroidSdk) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
if (-not $AndroidSdk) { throw 'Set ANDROID_HOME or pass -AndroidSdk for Android platform 36.' }
if (-not $Jdk) { throw 'Set JAVA_HOME or pass -Jdk for JDK 21.' }
if (-not $BuildTools) { $BuildTools = Join-Path $AndroidSdk 'build-tools\36.0.0' }

$platformJar = Join-Path $AndroidSdk 'platform\android-36\android.jar'
$java = Join-Path $Jdk 'bin\java.exe'
$javac = Join-Path $Jdk 'bin\javac.exe'
$jar = Join-Path $Jdk 'bin\jar.exe'
$keytool = Join-Path $Jdk 'bin\keytool.exe'
$aapt2 = Join-Path $BuildTools 'aapt2.exe'
$zipalign = Join-Path $BuildTools 'zipalign.exe'
$d8 = Join-Path $BuildTools 'lib\d8.jar'
$signer = Join-Path $BuildTools 'lib\apksigner.jar'

foreach ($required in @($platformJar, $java, $javac, $jar, $keytool, $aapt2, $zipalign, $d8, $signer)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required build tool is missing at $required" }
}

function Invoke-BuildStep([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$desktop = Join-Path $repo 'apps\desktop'
$out = Join-Path $PSScriptRoot 'out'
$work = Join-Path $out ("build-" + [guid]::NewGuid())
$assets = Join-Path $work 'assets'
$web = Join-Path $assets 'www'
$resources = Join-Path $work 'res'
$classes = Join-Path $work 'classes'
$dex = Join-Path $work 'dex'
$nativeResources = Join-Path $work 'resources.zip'
$nativeJar = Join-Path $work 'classes.jar'
$unsigned = Join-Path $work 'unsigned.apk'
$aligned = Join-Path $work 'aligned.apk'
$apk = Join-Path $out 'ActivityUsage.apk'
$keystore = Join-Path $out 'local.keystore'
New-Item -ItemType Directory -Force -Path $web, $classes, $dex, "$resources\drawable-nodpi" | Out-Null

try {
    Push-Location $desktop
    try {
        Invoke-BuildStep 'bun' @('x', 'vite', 'build', '--config', 'vite.renderer.config.ts', '--outDir', $web, '--emptyOutDir')
    } finally { Pop-Location }

    Copy-Item -LiteralPath (Join-Path $repo 'branding\activityusage-logo.png') -Destination "$resources\drawable-nodpi\activityusage.png"
    Copy-Item -Path (Join-Path $PSScriptRoot 'res\*') -Destination $resources -Recurse
    Invoke-BuildStep $aapt2 @('compile', '--dir', $resources, '-o', $nativeResources)
    Invoke-BuildStep $aapt2 @('link', '-I', $platformJar, '--manifest', (Join-Path $PSScriptRoot 'AndroidManifest.xml'),
        '-o', $unsigned, $nativeResources)

    $sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Recurse -Filter '*.java' | ForEach-Object FullName)
    Invoke-BuildStep $javac (@('--release', '17', '-classpath', $platformJar, '-d', $classes) + $sources)
    Invoke-BuildStep $jar @('cf', $nativeJar, '-C', $classes, '.')
    Invoke-BuildStep $java @('-cp', $d8, 'com.android.tools.r8.D8', '--lib', $platformJar, '--min-api', '30', '--output', $dex, $nativeJar)
    # The Windows aapt2 asset input retains backslashes in nested asset names.
    Invoke-BuildStep $jar @('uf', $unsigned, '-C', $dex, 'classes.dex', '-C', $work, 'assets')
    Invoke-BuildStep $zipalign @('-f', '4', $unsigned, $aligned)

    if (-not (Test-Path -LiteralPath $keystore)) {
        Invoke-BuildStep $keytool @('-genkeypair', '-keystore', $keystore, '-storepass', 'android', '-keypass', 'android',
            '-alias', 'local', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Activity Usage Local Android')
    }
    Invoke-BuildStep $java @('-jar', $signer, 'sign', '--ks', $keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $apk, $aligned)
    Invoke-BuildStep $java @('-jar', $signer, 'verify', $apk)
    Write-Output $apk
} finally {
    $resolvedWork = (Resolve-Path -LiteralPath $work).Path
    $resolvedOut = (Resolve-Path -LiteralPath $out).Path
    if ((Split-Path $resolvedWork -Parent) -eq $resolvedOut -and (Split-Path $resolvedWork -Leaf) -like 'build-*') {
        Remove-Item -LiteralPath $resolvedWork -Recurse -Force
    }
}
