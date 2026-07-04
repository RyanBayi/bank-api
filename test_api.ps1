try {
    $r = Invoke-RestMethod -Uri http://localhost:8080/api/summary -TimeoutSec 5
    $r | ConvertTo-Json -Compress
} catch {
    $_.Exception.Message
}
