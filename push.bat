@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if not %errorlevel%==0 goto :skip_js_tests

if exist node_modules goto :run_tests
echo Installing test dependencies, first run only...
call npm install --silent

:run_tests
echo Running tests...
call npm test
if errorlevel 1 goto :tests_failed
echo Tests passed.
goto :check_hugo

:tests_failed
echo.
echo Tests failed -- not pushing. Fix the issue above and run this again.
goto :end

:skip_js_tests
echo Node.js not found, skipping JS tests. Install from nodejs.org if you want this check to run.

:check_hugo
where hugo >nul 2>nul
if not %errorlevel%==0 goto :skip_hugo_build

echo Building site to check for errors...
hugo --minify >nul
if errorlevel 1 goto :build_failed
echo Build OK.
goto :do_commit

:build_failed
echo.
echo Site build failed -- not pushing. Run hugo here to see the full error.
goto :end

:skip_hugo_build
echo Hugo not found, skipping build check. Install from gohugo.io if you want this check to run.

:do_commit
git add -A

set "MSG="
set /p MSG="Commit message, press Enter for 'Update Glob': "
if "%MSG%"=="" set "MSG=Update Glob"

git commit -m "%MSG%"
if errorlevel 1 goto :commit_skipped
goto :do_pull

:commit_skipped
echo.
echo Nothing new to commit here.
goto :do_pull

:do_pull
echo.
echo Checking GitHub for anything saved from the Add or Edit page in the browser...
git pull --no-rebase --no-edit
if errorlevel 1 goto :pull_failed
goto :do_push

:pull_failed
echo.
echo Couldn't automatically merge in the latest changes from GitHub -- see the error above.
echo This usually means the same post was changed both here and in the browser.
echo Open the file it mentions, fix any conflict markers, save it, then run this again.
goto :end

:do_push
git push
if errorlevel 1 goto :push_failed
goto :push_ok

:push_failed
echo.
echo Push failed -- see the error above.
goto :end

:push_ok
echo.
echo Pushed. Check the Actions tab on GitHub to watch the build,
echo then reload the site in a minute or two.

:end
echo.
pause
