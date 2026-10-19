# Fast test runner (no GPU / ComfyUI required)
$py = "C:\Users\administrator\AppData\Roaming\uv\python\cpython-3.14.7-windows-x86_64-none\python.exe"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
& $py -m unittest discover -s tests -p "test_*.py" -v
$exit = $LASTEXITCODE
Pop-Location
exit $exit