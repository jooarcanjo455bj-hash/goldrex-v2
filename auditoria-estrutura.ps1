
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$out = Join-Path $root "AUDITORIA-ESTRUTURA-GOLDREX.txt"

"===== AUDITORIA ESTRUTURAL GOLDREX V2 =====" | Set-Content $out
"Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Add-Content $out

function Section($name) {
    "`r`n========== $name ==========" | Add-Content $out
}

Section "ARQUIVOS DO PROJETO"
Get-ChildItem $root -Recurse -Force -File |
Where-Object {
    $_.FullName -notmatch '\\node_modules\\|\\.git\\|\.backup'
} |
ForEach-Object {
    $_.FullName.Substring($root.Length + 1) | Add-Content $out
}

Section "SQL: TABELAS, FUNCOES, POLITICAS E TRIGGERS"
Get-ChildItem $root -Recurse -File -Filter "*.sql" |
Where-Object { $_.FullName -notmatch '\\node_modules\\|\.backup' } |
ForEach-Object {
    "`r`n--- $($_.FullName.Substring($root.Length + 1)) ---" | Add-Content $out
    Select-String -Path $_.FullName -Pattern 'CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY|CREATE OR REPLACE FUNCTION|CREATE FUNCTION|CREATE TRIGGER|CREATE INDEX|ENABLE ROW LEVEL SECURITY|GRANT |REVOKE |CREATE TYPE|CREATE EXTENSION|INSERT INTO storage' |
    ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" | Add-Content $out }
}

Section "REFERENCIAS DE SEGURANCA E SUPABASE"
Get-ChildItem $root -Recurse -File |
Where-Object {
    $_.Extension -in @(".js", ".sql", ".json") -and
    $_.FullName -notmatch '\\node_modules\\|\.backup'
} |
Select-String -Pattern 'createClient|supabase|service_role|auth\.|RLS|policy|storage|webhook|csrf|ADMIN_EMAILS|ADMIN_PATH|upload|session|password|confirm_order' |
ForEach-Object {
    "$($_.Path.Substring($root.Length + 1)):$($_.LineNumber) $($_.Line.Trim())" | Add-Content $out
}

Section "CONFIGURACOES"
$files = @(
    "package.json",
    "ecosystem.config.js",
    ".gitignore",
    "deploy/nginx-goldrex.conf",
    "deploy/atualizar.sh"
)
foreach ($file in $files) {
    $path = Join-Path $root $file
    if (Test-Path $path) {
        "`r`n--- $file ---" | Add-Content $out
        Get-Content $path | Add-Content $out
    }
}

Section "VARIAVEIS DE AMBIENTE: SOMENTE NOMES"
$envFile = Join-Path $root ".env.example"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
            "$($Matches[1])=<VALOR OMITIDO>" | Add-Content $out
        }
    }
}

Section "RESUMO"
"Arquivos SQL: $((Get-ChildItem $root -Recurse -File -Filter '*.sql' | Where-Object { $_.FullName -notmatch '\\node_modules\\|\.backup' }).Count)" | Add-Content $out
"Arquivos JavaScript: $((Get-ChildItem $root -Recurse -File -Filter '*.js' | Where-Object { $_.FullName -notmatch '\\node_modules\\|\.backup' }).Count)" | Add-Content $out

Write-Host "AUDITORIA CONCLUIDA." -ForegroundColor Green
Write-Host "Relatorio: $out" -ForegroundColor Cyan
Get-Item $out | Select-Object FullName, Length
