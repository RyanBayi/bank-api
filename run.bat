@echo off
setlocal enabledelayedexpansion
cd /d C:\Users\USER\Documents\ICT304TP\bank-api\bank-api
set "CP=target\classes"
for /f "usebackq delims=" %%i in ("target\cp.txt") do set "CP=!CP!;%%i"
echo Lancement de l'API Altas...
java -cp "!CP!" com.bank.api.BankApiApplication
