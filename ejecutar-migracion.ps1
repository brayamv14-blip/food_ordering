
$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '.env.migration'
if (-not (Test-Path $envFile)) {
    throw 'No existe .env.migration'
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*(APPWRITE_ENDPOINT|APPWRITE_PROJECT_ID|APPWRITE_API_KEY|APPWRITE_DATABASE_ID|APPWRITE_ORDERS_TABLE_ID|APPWRITE_USERS_TABLE_ID)\s*=\s*(.*)$') {
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

foreach ($name in @('APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "Falta la variable $name en .env.migration"
    }
}

Set-Location $PSScriptRoot
node scripts/appwrite-migrate.mjs --apply
