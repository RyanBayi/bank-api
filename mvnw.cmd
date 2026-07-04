@echo off
setlocal
set MVN_VERSION=3.9.6
set MAVEN_HOME=%USERPROFILE%\.m2\wrapper\dists\apache-maven-%MVN_VERSION%

if not exist "%MAVEN_HOME%\bin\mvn.cmd" (
    echo Downloading Maven %MVN_VERSION%...
    mkdir "%MAVEN_HOME%\.." 2>nul
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://archive.apache.org/dist/maven/maven-3/%MVN_VERSION%/binaries/apache-maven-%MVN_VERSION%-bin.zip' -OutFile '%TEMP%\maven.zip'" -ErrorAction Stop
    if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
    powershell -Command "Expand-Archive -Path '%TEMP%\maven.zip' -DestinationPath '%MAVEN_HOME%\..' -Force"
    move "%MAVEN_HOME%\..\apache-maven-%MVN_VERSION%" "%MAVEN_HOME%" 2>nul
)
set PATH=%MAVEN_HOME%\bin;%PATH%
call mvn %*
