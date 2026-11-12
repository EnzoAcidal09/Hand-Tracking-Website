param(
  [int]$Port = 8000,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$url = "http://localhost:$Port/"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".wasm" = "application/wasm"
  ".task" = "application/octet-stream"
  ".woff2" = "font/woff2"
  ".woff" = "font/woff"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
  ".md"   = "text/markdown; charset=utf-8"
  ".map"  = "application/json; charset=utf-8"
}

try {
  $listener = [System.Net.HttpListener]::new()
  $listener.Prefixes.Add($url)
  $listener.Start()
}
catch {
  Write-Host ""
  Write-Host "  Could not start Airform on $url" -ForegroundColor Red
  Write-Host "  The port may be busy, or Windows may need permission for local HTTP." -ForegroundColor DarkGray
  Write-Host "  Try another port:" -ForegroundColor DarkGray
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\server.ps1 -Port 8080" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  AIRFORM / local studio" -ForegroundColor Green
Write-Host "  Serving $root" -ForegroundColor DarkGray
Write-Host "  Open     $url" -ForegroundColor White
Write-Host "  Stop     Ctrl + C" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $url
}

while ($listener.IsListening) {
  $context = $null

  try {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $requestPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($requestPath) -or $requestPath -eq "/") {
      $requestPath = "/index.html"
    }

    $relativePath = $requestPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))
    $rootWithSeparator = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

    if (-not $fullPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
      $response.StatusCode = 403
      $response.ContentType = "text/plain; charset=utf-8"
      $response.ContentLength64 = $body.Length
      $response.OutputStream.Write($body, 0, $body.Length)
      continue
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $response.StatusCode = 404
      $response.ContentType = "text/plain; charset=utf-8"
      $response.ContentLength64 = $body.Length
      $response.OutputStream.Write($body, 0, $body.Length)
      continue
    }

    $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
    $contentType = $mimeTypes[$extension]
    if (-not $contentType) {
      $contentType = "application/octet-stream"
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $response.StatusCode = 200
    $response.ContentType = $contentType
    $response.ContentLength64 = $bytes.Length
    $response.Headers.Add("Cache-Control", "no-store")
    $response.Headers.Add("X-Content-Type-Options", "nosniff")

    if ($request.HttpMethod -ne "HEAD") {
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  }
  catch [System.Net.HttpListenerException] {
    # A browser can close a connection early. Keep serving.
  }
  catch {
    Write-Host ("  Request error: " + $_.Exception.Message) -ForegroundColor DarkYellow
    if ($null -ne $context) {
      try {
        $context.Response.StatusCode = 500
      }
      catch { }
    }
  }
  finally {
    if ($null -ne $context) {
      try { $context.Response.Close() } catch { }
    }
  }
}
