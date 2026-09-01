@echo off
REM ---------------------------------------------------------------------------
REM  SalesDash - subir cambios a GitHub
REM
REM  Comprueba que el proyecto compila y pasa las pruebas ANTES de subir nada.
REM  Si algo falla, se detiene y no sube: es mucho mas barato enterarse aqui
REM  que en el despliegue, con el panel caido.
REM
REM  Doble clic, y cuando diga LISTO entras a EasyPanel y pulsas Deploy.
REM ---------------------------------------------------------------------------
cd /d "%~dp0"
title SalesDash - subir cambios

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
git add -A
git commit -m "Messenger: entrar con Facebook, bandeja de comentarios y pantalla limpia" -m "Conectar una pagina ya no pide pegar un token. Un boton abre la ventana de Facebook, la ventana devuelve un codigo y el servidor lo cambia por el token de pagina usando META_APP_SECRET: el token no pasa por el navegador ni una vez. El camino manual sigue existiendo, pero solo lo ve superadmin." -m "Nuevo: bandeja de comentarios por pagina, con selector y estado de respondido, debajo de las paginas conectadas. Un comentario no es una tabla aparte: es una conversacion con superficie 'comentario', y cada fila abre el hilo entero." -m "Lo tecnico -nombres de variables, URL del webhook, eventos crudos- se pliega en Diagnostico tecnico y solo aparece para superadmin. Al dueno de la tienda se le muestran su pagina, sus comentarios y sus anuncios." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01PPh11ksvXPfByAoQu75rfo"

if errorlevel 1 echo    (no habia nada nuevo que guardar - se sigue igual)

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
echo   Entra a EasyPanel, servicio agente1-salesdash, y pulsa Deploy.
echo ===========================================================
echo.
pause
exit /b 0

:fallo
echo.
echo ===========================================================
echo   ALGO FALLO - NO se ha subido nada
echo.
echo   Mira el mensaje de arriba. Si no lo entiendes, copialo
echo   y pasamelo tal cual.
echo ===========================================================
echo.
pause
exit /b 1
