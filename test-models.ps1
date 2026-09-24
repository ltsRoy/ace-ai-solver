# Tests which Gemini models respond with your key. Key is read securely and never saved.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "Continue"
$sec = Read-Host "Paste Gemini API key" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$base = "https://generativelanguage.googleapis.com/v1beta/models"

# Every generateContent model your key can see
$all = (Invoke-RestMethod "$base`?pageSize=200" -Headers @{ "x-goog-api-key" = $key }).models |
  Where-Object { $_.supportedGenerationMethods -contains "generateContent" -and $_.name -match "gemini" -and $_.name -notmatch "tts|image|live|transcribe|embedding|translate|omni" } |
  ForEach-Object { $_.name -replace "^models/", "" }

Write-Host "Testing $($all.Count) models: $($all -join ', ')`n"
$body = '{"contents":[{"parts":[{"text":"Reply with just: OK"}]}]}'
$results = foreach ($m in $all) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-RestMethod "$base/$m`:generateContent" -Method Post -ContentType "application/json" `
      -Headers @{ "x-goog-api-key" = $key } -Body $body -TimeoutSec 40
    $status = "WORKS"; $note = ($r.candidates[0].content.parts.text -join "").Trim()
  } catch {
    $err = $_
    $status = "FAIL"
    $note = $err.Exception.Message
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
      try { $note = ($err.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { $note = $err.ErrorDetails.Message }
    }
    if (-not $note) { $note = "unknown error" }
    if ($note.Length -gt 70) { $note = $note.Substring(0, 70) }
  }
  Write-Host ("{0,-5} {1,-40} {2,6}ms  {3}" -f $status, $m, $sw.ElapsedMilliseconds, $note)
  [pscustomobject]@{ Model = $m; Status = $status; Ms = $sw.ElapsedMilliseconds; Note = $note }
}
$results | Sort-Object Status, Ms | Format-Table -AutoSize
