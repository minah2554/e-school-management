@echo off
echo ===================================================
echo  학생선수 관리 웹앱 자동 빌드/깃/배포 스크립트
echo ===================================================
echo.

echo [1/4] 1. React 앱 빌드 중...
call npm.cmd run build
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 빌드에 실패했습니다. 코드를 확인해 주세요.
    pause
    exit /b %ERRORLEVEL%
)
echo.

echo [2/4] 2. Git 변경사항 커밋 중...
git add .
set "msg="
set /p msg="커밋 메시지를 입력하세요 (엔터 입력 시 '디자인 및 설정 최신화'): "
if "%msg%"=="" set msg=디자인 및 설정 최신화

git commit -m "%msg%"
echo.

echo [3/4] 3. 깃허브(GitHub)에 코드 업로드 중...
git push origin main
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 깃허브 업로드(Push)에 실패했습니다. 네트워크 또는 권한을 확인하세요.
    pause
    exit /b %ERRORLEVEL%
)
echo.

echo [4/4] 4. 파이어베이스(Firebase) 서버 배포 중...
call npx.cmd -p firebase-tools firebase deploy
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 파이어베이스 배포에 실패했습니다.
    pause
    exit /b %ERRORLEVEL%
)
echo.

echo ===================================================
echo  🎉 모든 작업이 완료되었습니다!
echo  배포된 주소: https://e-school-management-64e37.web.app
echo ===================================================
pause
