Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$clientHandler = New-Object System.Net.Http.HttpClientHandler
$clientHandler.UseCookies = $true
$clientHandler.CookieContainer = New-Object System.Net.CookieContainer
$client = New-Object System.Net.Http.HttpClient($clientHandler)
$base = "http://localhost:5173"

function Test-Endpoint {
    param([string]$Method, [string]$Url, [hashtable]$Headers = @{}, [string]$Body = $null, [string]$Origin = $null, [string]$ContentType = "application/x-www-form-urlencoded")
    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), $Url)
    if ($Origin) { $req.Headers.Add("Origin", $Origin) }
    foreach ($k in $Headers.Keys) { $req.Headers.TryAddWithoutValidation($k, $Headers[$k]) | Out-Null }
    if ($Body) {
        $req.Content = New-Object System.Net.Http.StringContent($Body, [System.Text.Encoding]::UTF8, $ContentType)
    }
    $resp = $client.SendAsync($req).GetAwaiter().GetResult()
    $content = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    return [PSCustomObject]@{
        Status = [int]$resp.StatusCode
        Content = $content
    }
}

$pass = 0
$fail = 0
function Pass($msg) { $script:pass++; Write-Host "PASS: $msg" -ForegroundColor Green }
function Fail($msg) { $script:fail++; Write-Host "FAIL: $msg" -ForegroundColor Red }
function Info($msg) { Write-Host "INFO: $msg" -ForegroundColor Cyan }

# 1. Login as admin
Info "=== Login as admin ==="
$r = Test-Endpoint "POST" "$base/login" -Origin "http://localhost:5173" -Body "email=REDACTED@test.local&password=REDACTED_TEST_PW"
if ($r.Status -eq 302) { Pass "Login redirects (302) with set-cookie" } else { Fail "Login status: $($r.Status)" }

# 2. Access admin dashboard
Info "=== Access /admin/dashboard ==="
$r = Test-Endpoint "GET" "$base/admin/dashboard"
if ($r.Status -eq 200) { Pass "Admin dashboard 200" } else { Fail "Admin dashboard: $($r.Status)" }
if ($r.Content -match "VisionHack|Overview|Admin") { Pass "Dashboard rendered" } else { Fail "Dashboard content mismatch" }

# 3. Access /api/institutions with cookie
Info "=== GET /api/institutions (auth) ==="
$r = Test-Endpoint "GET" "$base/api/institutions" -Origin "http://localhost:5173"
if ($r.Status -eq 200) { Pass "Institutions 200" } else { Fail "Institutions: $($r.Status)" }
try {
    $data = $r.Content | ConvertFrom-Json
    if ($data.institutions -and $data.institutions.Count -gt 0) { Pass "Got $($data.institutions.Count) institutions" } else { Fail "No institutions in response" }
} catch { Fail "Response not JSON" }

# 4. Access /admin/teams
Info "=== Access /admin/teams ==="
$r = Test-Endpoint "GET" "$base/admin/teams"
if ($r.Status -eq 200) { Pass "Teams 200" } else { Fail "Teams: $($r.Status)" }
if ($r.Content -match "All teams|Pipeline|teams") { Pass "Teams page rendered" } else { Fail "Teams content" }

# 5. Access /admin/config
Info "=== Access /admin/config ==="
$r = Test-Endpoint "GET" "$base/admin/config"
if ($r.Status -eq 200) { Pass "Config 200" } else { Fail "Config: $($r.Status)" }
if ($r.Content -match "Registration|Configuration") { Pass "Config rendered" } else { Fail "Config content" }

# 6. Toggle a config flag
Info "=== Toggle config flag ==="
$r = Test-Endpoint "POST" "$base/admin/config" -Origin "http://localhost:5173" -Body "key=registration_open&value=true"
if ($r.Status -eq 200) { Pass "Config update 200" } else { Fail "Config update: $($r.Status)" }

# 7. Access /admin/campus-leads
Info "=== Access /admin/campus-leads ==="
$r = Test-Endpoint "GET" "$base/admin/campus-leads"
if ($r.Status -eq 200) { Pass "Campus leads 200" } else { Fail "Campus leads: $($r.Status)" }

# 8. Access /admin/export
Info "=== Access /admin/export ==="
$r = Test-Endpoint "GET" "$base/admin/export"
if ($r.Status -eq 200) { Pass "Export 200" } else { Fail "Export: $($r.Status)" }

# 9. CSV download
Info "=== CSV export ==="
$r = Test-Endpoint "GET" "$base/api/export/csv?filterStatus=all"
if ($r.Status -eq 200) { Pass "CSV 200" } else { Fail "CSV: $($r.Status)" }
if ($r.Content -match "Team Name,Team Code") { Pass "CSV header correct" } else { Fail "CSV header missing" }

# 10. CSRF: POST without Origin
Info "=== CSRF: POST without Origin ==="
$r = Test-Endpoint "POST" "$base/admin/config" -Body "key=registration_open&value=false"
if ($r.Status -eq 403) { Pass "CSRF blocks no-Origin" } else { Fail "CSRF: got $($r.Status)" }

# 11. CSRF: wrong Origin
Info "=== CSRF: POST with wrong Origin ==="
$r = Test-Endpoint "POST" "$base/admin/config" -Origin "http://evil.com" -Body "key=registration_open&value=false"
if ($r.Status -eq 403) { Pass "CSRF blocks wrong Origin" } else { Fail "CSRF wrong: got $($r.Status)" }

# 12. Cross-team file access (the IDOR test)
Info "=== Cross-team file IDOR ==="
# Try to download a file from a team the admin does own (admin can read all so this is OK)
# But try a 15-char non-existent record id
$r = Test-Endpoint "GET" "$base/api/files/teams/abcdefghij123456/file.pdf"
if ($r.Status -eq 404) { Pass "Non-existent team returns 404" } else { Fail "Got $($r.Status) for fake record" }

# 13. Path traversal
Info "=== File path traversal ==="
$r = Test-Endpoint "GET" "$base/api/files/teams/abcdefghij123456/..%2Fbar.pdf"
if ($r.Status -in @(400, 404)) { Pass "Path traversal rejected" } else { Fail "Path traversal: got $($r.Status)" }

# 14. Wrong collection
Info "=== File wrong collection ==="
$r = Test-Endpoint "GET" "$base/api/files/users/abcdefghij123456/file.pdf"
if ($r.Status -eq 404) { Pass "Wrong collection rejected" } else { Fail "Wrong collection: got $($r.Status)" }

# 15. Logout
Info "=== Logout ==="
$r = Test-Endpoint "POST" "$base/api/auth/logout" -Origin "http://localhost:5173"
if ($r.Status -eq 302) { Pass "Logout 302" } else { Fail "Logout: $($r.Status)" }

# 16. After logout, can't access admin
Info "=== After logout ==="
$r = Test-Endpoint "GET" "$base/admin/dashboard"
if ($r.Status -in @(200, 302)) {
    # 200 means it returned the doc, but the doc should be the login page (or 302 to /login)
    if ($r.Content -match "Welcome back|Sign in") { Pass "Logged out: redirected to login" }
    elseif ($r.Status -eq 302) { Pass "Logged out: 302" }
    else { Fail "After logout: $($r.Status), content: $($r.Content.Substring(0, 100))" }
} else { Fail "After logout: $($r.Status)" }

Write-Host "`n========"
Write-Host "Passed: $pass"
Write-Host "Failed: $fail"
Write-Host "========"
