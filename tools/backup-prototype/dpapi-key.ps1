param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('protect', 'unprotect')]
    [string] $Mode,

    [Parameter(Mandatory = $true)]
    [string] $Path
)

$ErrorActionPreference = 'Stop'
$entropy = [System.Text.Encoding]::UTF8.GetBytes('WatchTube backup prototype v1')
$key = $null
$protected = $null

try {
    Add-Type -AssemblyName System.Security

    if ($Mode -eq 'protect') {
        $encodedKey = [Console]::In.ReadToEnd().Trim()
        $key = [Convert]::FromBase64String($encodedKey)
        if ($key.Length -ne 32) {
            throw 'Expected a 32-byte AES key.'
        }

        $protected = [System.Security.Cryptography.ProtectedData]::Protect(
            $key,
            $entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        try {
            $stream.Write($protected, 0, $protected.Length)
        }
        finally {
            $stream.Dispose()
        }
    }
    else {
        $protected = [System.IO.File]::ReadAllBytes($Path)
        $key = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $protected,
            $entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        if ($key.Length -ne 32) {
            throw 'The protected key did not contain 32 bytes.'
        }

        [Console]::Out.Write([Convert]::ToBase64String($key))
    }
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
finally {
    if ($null -ne $key) {
        [Array]::Clear($key, 0, $key.Length)
    }
    if ($null -ne $protected) {
        [Array]::Clear($protected, 0, $protected.Length)
    }
    [Array]::Clear($entropy, 0, $entropy.Length)
}