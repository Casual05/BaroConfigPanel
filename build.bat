@echo off
chcp 65001 >nul
title BaroConfigPanel 打包工具

echo ====================================
echo  潜渊症配置面板 - 打包工具
echo ====================================
echo.

echo 1/3 安装依赖...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [FAIL] 依赖安装失败
    pause
    exit /b 1
)
echo [OK]

echo 2/3 清理旧构建...
if exist dist\BaroConfigPanel.exe del /f /q dist\BaroConfigPanel.exe
if exist build rmdir /s /q build
echo [OK]

echo 3/3 打包中...
pyinstaller --onefile --windowed ^
  --name "BaroConfigPanel" ^
  --add-data "frontend;frontend" ^
  --noconfirm ^
  main.py

if %errorlevel% neq 0 (
    echo [FAIL] 打包失败
    pause
    exit /b 1
)

echo.
echo ====================================
echo  打包成功！
echo  exe 位置: %CD%\dist\BaroConfigPanel.exe
echo ====================================
pause
