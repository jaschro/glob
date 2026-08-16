@echo off
setlocal

rem Run this from inside your Glob folder (double-click it there).
cd /d "%~dp0"

echo Glob setup
echo ==========
echo.

if exist ".git" (
    echo Removing existing .git folder from the earlier failed attempt...
    rd /s /q ".git"
)

git init
if errorlevel 1 goto :error

git add .
git commit -m "Initial glob scaffold"
if errorlevel 1 goto :error

git branch -M main

echo.
echo Create an empty repo on github.com first if you haven't yet
echo   - suggested name: glob
echo   - public, no README/license/gitignore (this folder already has files)
echo.
set /p REPO_URL="Paste the repo URL (e.g. https://github.com/USERNAME/glob.git): "

git remote add origin "%REPO_URL%"
if errorlevel 1 goto :error

git push -u origin main
if errorlevel 1 goto :error

echo.
echo Pushed. Now on GitHub: Settings -^> Pages -^> set Source to "GitHub Actions".
echo Check the Actions tab to watch the first build run.
goto :end

:error
echo.
echo Something went wrong -- see the error above.
echo (If git complains about missing user.name/user.email, run:
echo   git config --global user.name "Your Name"
echo   git config --global user.email "you@example.com"
echo  and then re-run this script.)

:end
echo.
pause
