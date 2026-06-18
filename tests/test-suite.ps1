Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient

function Test-Endpoint {
    param([string]$Method, [string]$Url, [hashtable]$Headers = @{}, [string]$Body = $null, [string]$Origin = $null)
    $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), $Url)
    if ($Origin) { $req.Headers.Add("Origin", $Origin) }
    foreach ($k in $Headers.Keys) { $req.Headers.TryAddWithoutValidation($k, $Headers[$k]) }
    if ($Body) {
        $req.Content = New-Object System.Net.Http.StringContent($Body, [System.Text.Encoding]::UTF8, "application/x-www-form-urlencoded")
    }
    $resp = $client.SendAsync($req).GetAwaiter().GetResult()
    $content = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    return [PSCustomObject]@{
        Status = [int]$resp.StatusCode
        Content = $content
        Headers = $resp.Headers
    }
}

# -------- Test 1: Home page redirects (with cookie) to /login (no cookie) --------
Write-Host "=== Test 1: GET / (no auth) ===" -ForegroundColor Cyan
$r = Test-Endpoint "GET" "http://localhost:5173/"
Write-Host "Status: $($r.Status)"

# -------- Test 2: /login renders --------
Write-Host "`n=== Test 2: GET /login ===" -ForegroundColor Cyan
$r = Test-Endpoint "GET" "http://localhost:5173/login"
Write-Host "Status: $($r.Status), Length: $($r.Content.Length)"
if ($r.Content -match "Welcome back") { Write-Host "PASS: login page renders" -ForegroundColor Green } else { Write-Host "FAIL: login form not found" -ForegroundColor Red }

# -------- Test 3: /forgot-password renders --------
Write-Host "`n=== Test 3: GET /forgot-password ===" -ForegroundColor Cyan
$r = Test-Endpoint "GET" "http://localhost:5173/forgot-password"
Write-Host "Status: $($r.Status), Length: $($r.Content.Length)"
if ($r.Content -match "Recover access|Get back in") { Write-Host "PASS" -ForegroundColor Green } else { Write-Host "FAIL" -ForegroundColor Red }

# -------- Test 4: /api/institutions requires auth --------
Write-Host "`n=== Test 4: GET /api/institutions (no auth) ===" -ForegroundColor Cyan
$r = Test-Endpoint "GET" "http://localhost:5173/api/institutions"
Write-Host "Status: $($r.Status)"
if ($r.Status -eq 401) { Write-Host "PASS: 401 without auth" -ForegroundColor Green } else { Write-Host "WARN: expected 401, got $($r.Status)" -ForegroundColor Yellow }

# -------- Test 5: POST /login without Origin header should be 403 (CSRF) --------
Write-Host "`n=== Test 5: POST /login (no Origin) ===" -ForegroundColor Cyan
$r = Test-Endpoint "POST" "http://localhost:5173/login" -Body "email=test@test.com&password=test"
Write-Host "Status: $($r.Status)"
if ($r.Status -eq 403) { Write-Host "PASS: CSRF blocks no-Origin" -ForegroundColor Green } else { Write-Host "FAIL: expected 403, got $($r.Status)" -ForegroundColor Red }

# -------- Test 6: POST /login with valid Origin + bad creds → 401 + masked error --------
Write-Host "`n=== Test 6: POST /login (bad creds) ===" -ForegroundColor Cyan
$r = Test-Endpoint "POST" "http://localhost:5173/login" -Origin "http://localhost:5173" -Body "email=fake@example.com&password=wrong"
Write-Host "Status: $($r.Status)"
if ($r.Status -eq 401) { Write-Host "PASS" -ForegroundColor Green } else { Write-Host "WARN: expected 401, got $($r.Status)" -ForegroundColor Yellow }
if ($r.Content -match "Invalid email or password") { Write-Host "PASS: generic error message" -ForegroundColor Green } else { Write-Host "WARN: error text: $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))" -ForegroundColor Yellow }

# -------- Test 7: GET /api/institutions still requires auth even with Origin --------
Write-Host "`n=== Test 7: GET /api/institutions with origin ===" -ForegroundColor Cyan
$r = Test-Endpoint "GET" "http://localhost:5173/api/institutions" -Origin "http://localhost:5173"
Write-Host "Status: $($r.Status)"
if ($r.Status -eq 401) { Write-Host "PASS" -ForegroundColor Green } else { Write-Host "WARN: expected 401, got $($r.Status)" -ForegroundColor Yellow }

# -------- Test 8: GET /api/files/teams/INVALID/anything — bad record id rejected --------
Write-Host "`n=== Test 8: GET /api/files/teams/SHORT/anything ===" -ForegroundColor Cyan
$r = Test-Endpoint "GET" "http://localhost:5173/api/files/teams/SHORT/anything" -Origin "http://localhost:5173"
Write-Host "Status: $($r.Status)"
if ($r.Status -eq 404) { Write-Host "PASS: short id rejected" -ForegroundColor Green } else { Write-Host "WARN: expected 404, got $($r.Status)" -ForegroundColor Yellow }

# -------- Test 9: GET /api/files/teams/{15chars}/foo/../bar — path traversal --------
Write-Host "`n=== Test 9: GET /api/files path traversal ===" -ForegroundColor Cyan
$r = Test-Endpoint "GET" "http://localhost:5173/api/files/teams/abcdefghij123456/..%2Fbar"
Write-Host "Status: $($r.Status)"
if ($r.Status -in @(400, 401, 404)) { Write-Host "PASS: rejected" -ForegroundColor Green } else { Write-Host "WARN: got $($r.Status)" -ForegroundColor Yellow }

# -------- Test 10: POST /api/auth/logout (no Origin) → 403 --------
Write-Host "`n=== Test 10: POST /api/auth/logout (no Origin) ===" -ForegroundColor Cyan
$r = Test-Endpoint "POST" "http://localhost:5173/api/auth/logout"
Write-Host "Status: $($r.Status)"
if ($r.Status -eq 403) { Write-Host "PASS: CSRF blocks logout" -ForegroundColor Green } else { Write-Host "FAIL: expected 403, got $($r.Status)" -ForegroundColor Red }

# -------- Test 11: GET /admin/dashboard (no auth) → redirect to /login --------
Write-Host "`n=== Test 11: GET /admin/dashboard (no auth) ===" -ForegroundColor Cyan
try {
    $r = Test-Endpoint "GET" "http://localhost:5173/admin/dashboard"
    Write-Host "Status: $($r.Status)"
} catch {
    Write-Host "Status: $($_.Exception.Message)"
}

# -------- Test 12: POST /admin/teams (no auth, with Origin) → 403 --------
Write-Host "`n=== Test 12: POST /admin/teams (no auth) ===" -ForegroundColor Cyan
$r = Test-Endpoint "POST" "http://localhost:5173/admin/teams" -Origin "http://localhost:5173" -Body "intent=test"
Write-Host "Status: $($r.Status)"
if ($r.Status -in @(401, 403)) { Write-Host "PASS: protected" -ForegroundColor Green } else { Write-Host "WARN: got $($r.Status)" -ForegroundColor Yellow }

# -------- Test 13: Forgot password (with Origin) — no info leak --------
Write-Host "`n=== Test 13: POST /forgot-password (existing email) ===" -ForegroundColor Cyan
$r = Test-Endpoint "POST" "http://localhost:5173/forgot-password" -Origin "http://localhost:5173" -Body "email=test@example.com"
Write-Host "Status: $($r.Status)"
if ($r.Content -match "Check your inbox") { Write-Host "PASS: success view rendered" -ForegroundColor Green } else { Write-Host "WARN: did not find success state" -ForegroundColor Yellow }

# -------- Test 14: Forgot password (no Origin) → 403 --------
Write-Host "`n=== Test 14: POST /forgot-password (no Origin) ===" -ForegroundColor Cyan
$r = Test-Endpoint "POST" "http://localhost:5173/forgot-password" -Body "email=test@example.com"
Write-Host "Status: $($r.Status)"
if ($r.Status -eq 403) { Write-Host "PASS" -ForegroundColor Green } else { Write-Host "FAIL: expected 403, got $($r.Status)" -ForegroundColor Red }

Write-Host "`n=== Test suite complete ===" -ForegroundColor Cyan
