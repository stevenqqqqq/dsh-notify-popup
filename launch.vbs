' Hidden launcher for @local/dsh-notify-popup.
' wscript.exe is a GUI-subsystem binary, so it never creates a console window.
' Shell.Run with window style 0 (SW_HIDE) starts powershell.exe fully hidden.
' Environment variables (DSH_NOTIFY_*) are inherited from the plugin host.
Option Explicit

Dim shell, psScript, cmd
Set shell = CreateObject("WScript.Shell")
psScript = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "notify.ps1"
cmd = "powershell.exe -NoProfile -NonInteractive -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psScript & """"
shell.Run cmd, 0, False
