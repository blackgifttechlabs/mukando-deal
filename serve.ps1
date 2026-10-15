# Tiny web server for Mukando Manager on Windows. Needs nothing installed: PowerShell is built in.
# Run START-MUKANDO.bat (or: powershell -ExecutionPolicy Bypass -File serve.ps1), then open http://localhost:8765
param([int]$Port = 8765)
$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.wasm' = 'application/wasm'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
  '.svg' = 'image/svg+xml'; '.md' = 'text/plain; charset=utf-8'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Host "Could not start on port $Port. Is it already running? Try: serve.ps1 -Port 8766"; exit 1 }
Write-Host "Mukando Manager is running at http://localhost:$Port  (close this window to stop)"
Start-Process "http://localhost:$Port/"
while ($listener.IsListening) {
  $context = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    # Never serve anything outside the project folder.
    if (-not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) {
      $context.Response.StatusCode = 404
    } else {
      $bytes = [IO.File]::ReadAllBytes($file)
      $type = $types[[IO.Path]::GetExtension($file).ToLower()]
      $context.Response.ContentType = if ($type) { $type } else { 'application/octet-stream' }
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch { $context.Response.StatusCode = 500 }
  finally { $context.Response.Close() }
}
