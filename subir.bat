@echo off
setlocal enabledelayedexpansion
REM ---------------------------------------------------------------------------
REM  SalesDash - subir cambios a GitHub
REM
REM  Comprueba que el proyecto compila y pasa las pruebas ANTES de subir nada.
REM  Si algo falla, se detiene y no sube: es mucho mas barato enterarse aqui
REM  que en el despliegue, con el panel caido.
REM
REM  Doble clic, y cuando diga LISTO entras a EasyPanel y pulsas Deploy:
REM  proyecto seledash, servicio seledash.
REM
REM  EL MENSAJE DEL COMMIT SE PREGUNTA, YA NO VIENE ESCRITO AQUI DENTRO.
REM
REM  Antes estaba fijo en este archivo. Eso funciona una vez: a la siguiente,
REM  `git add -A` recoge un cambio nuevo y lo guarda con el titulo del cambio
REM  anterior. El historial pasa a mentir sin que salte ningun error, y el dia
REM  que hay que revertir algo en produccion no hay forma de saber que commit
REM  trajo que. Preguntarlo cuesta una linea escrita y lo cierra.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"
title SalesDash - subir cambios

REM  Que estamos DENTRO del repositorio, antes que nada.
REM
REM  Si no lo estuvieramos -el bat copiado a otra carpeta, la carpeta de
REM  OneDrive a medio sincronizar-, `git status` falla, el paso 3 lo lee como
REM  "no hay nada que guardar" y el script seguiria feliz hasta el push. Se
REM  para aqui, que es donde se entiende lo que pasa.
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :noEsRepo

echo.
echo ===========================================================
echo   1 de 4   Comprobando que el proyecto compila
echo ===========================================================
call npm run typecheck
if errorlevel 1 goto :fallo

echo.
echo ===========================================================
echo   2 de 4   Pruebas
echo ===========================================================
call npm test
if errorlevel 1 goto :fallo

echo.
echo ===========================================================
echo   3 de 4   Guardando el commit
echo ===========================================================

REM  Sin nada pendiente no se pregunta nada: se pasa directo a subir. Es el
REM  caso normal cuando el commit ya se hizo por otro lado y solo falta el push.
set "hay="
for /f "delims=" %%i in ('git status --porcelain') do set "hay=1"
if not defined hay goto :nadaQueGuardar

echo.
echo   Esto es lo que se va a guardar:
echo.
git status --short
echo.
echo   -----------------------------------------------------------
echo   Escribe en UNA linea que has cambiado y pulsa Enter.
echo   Sin comillas ni el simbolo %% - al bat no le sientan bien.
echo   Si lo dejas vacio no se guarda ni se sube NADA.
echo   -----------------------------------------------------------
echo.
set "mensaje="
set /p "mensaje=Que has cambiado: "
if not defined mensaje goto :sinMensaje

git add -A
if errorlevel 1 goto :fallo

git commit -m "!mensaje!" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
if errorlevel 1 goto :fallo
goto :subir

:nadaQueGuardar
echo.
echo   No hay nada nuevo que guardar. Se sigue con lo que ya esta
echo   en commits sin subir.

:subir
echo.
echo ===========================================================
echo   4 de 4   Subiendo a GitHub
echo ===========================================================
git push
if errorlevel 1 goto :fallo

echo.
echo ===========================================================
echo   LISTO
echo.
echo   Entra a EasyPanel, proyecto seledash, servicio seledash,
echo   y pulsa Deploy.
echo.
echo   El panel queda en:
echo   https://seledash-seledash.pltte0.easypanel.host
echo ===========================================================
echo.
pause
exit /b 0

:sinMensaje
echo.
echo ===========================================================
echo   NO se ha guardado ni subido nada
echo.
echo   Hace falta una linea que diga que cambiaste. Vuelve a
echo   darle doble clic cuando la tengas pensada.
echo ===========================================================
echo.
pause
exit /b 1

:noEsRepo
echo.
echo ===========================================================
echo   ESTA CARPETA NO ES EL PROYECTO
echo.
echo   Este bat tiene que vivir dentro de la carpeta Dashboard,
echo   la que tiene package.json al lado. NO se ha subido nada.
echo ===========================================================
echo.
pause
exit /b 1
