# Genera evidencias-git.txt con ramas, historial, etiquetas y remoto para capturar en el documento.
# Uso (PowerShell, desde la raiz del repo):  .\scripts\evidencias-git.ps1
# Solo LEE el repositorio: no hace commits, ramas, etiquetas ni push. (Script no probado en PowerShell por el autor.)
$out = "evidencias-git.txt"
"== Repositorio remoto ==" | Out-File $out -Encoding utf8
git remote -v | Out-File $out -Append -Encoding utf8
"`n== Ramas (locales y remotas) ==" | Out-File $out -Append -Encoding utf8
git branch -a --list | Out-File $out -Append -Encoding utf8
"`n== Historial de commits (grafico) ==" | Out-File $out -Append -Encoding utf8
git log --oneline --graph --decorate --all --date=short -n 80 | Out-File $out -Append -Encoding utf8
"`n== Fusiones (merge commits) ==" | Out-File $out -Append -Encoding utf8
git log --merges --oneline --date=short -n 40 | Out-File $out -Append -Encoding utf8
"`n== Etiquetas de version ==" | Out-File $out -Append -Encoding utf8
git tag -n --sort=creatordate | Out-File $out -Append -Encoding utf8
"`n== Autores y numero de commits ==" | Out-File $out -Append -Encoding utf8
git shortlog -sn --all | Out-File $out -Append -Encoding utf8
Write-Host "Listo: $out  (abre el archivo y captura la pantalla para la evidencia)"
