## 下載

| 平台 | 檔案 |
|---|---|
| Mac（Apple 晶片 M1 以後） | `MindMap_*_aarch64.dmg` |
| Mac（Intel） | `MindMap_*_x64.dmg` |
| Windows | `MindMap_*_x64-setup.exe` 或 `.msi` |
| Linux | `.AppImage`、`.deb` 或 `.rpm` |
| Android | `MindMap_*_android.apk` |

iOS 版需要 Apple 開發者帳號才能發布安裝檔，目前請從原始碼自行編譯。

## 第一次打開時的提醒

這些安裝檔還沒有做開發者簽章，系統可能會擋：

- **Mac**：如果出現「無法打開」或「已損毀」，在終端機執行 `xattr -cr /Applications/MindMap.app`，或在 App 上按右鍵 →「打開」。
- **Windows**：如果出現 SmartScreen 警告，點「其他資訊」→「仍要執行」。
- **Android**：需要在設定裡允許「安裝不明來源的應用程式」。
