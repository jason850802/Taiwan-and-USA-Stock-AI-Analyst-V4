"""03 專用隱藏主控台：只向此 helper 建立、且建立時間吻合的 console 發送事件。"""
import ctypes
import json
import os
import subprocess
import sys
import time
from ctypes import wintypes

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
user = ctypes.WinDLL('user32', use_last_error=True)
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
kernel.GetConsoleWindow.restype = wintypes.HWND
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]


def creation(pid):
  handle = kernel.OpenProcess(0x1000, False, pid)
  if not handle:
    raise ctypes.WinError(ctypes.get_last_error())
  try:
    times = [wintypes.FILETIME() for _ in range(4)]
    if not kernel.GetProcessTimes(handle, *(ctypes.byref(item) for item in times)):
      raise ctypes.WinError(ctypes.get_last_error())
    return str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime)
  finally:
    kernel.CloseHandle(handle)


mode = sys.argv[1]
if mode == 'launch':
  log, cwd, executable, *args = sys.argv[2:]
  startup = subprocess.STARTUPINFO()
  startup.dwFlags = subprocess.STARTF_USESHOWWINDOW
  startup.wShowWindow = 0
  with open(log, 'xb', buffering=0) as output:
    child = subprocess.Popen([executable, *args], cwd=cwd, stdin=subprocess.DEVNULL,
      stdout=output, stderr=output, startupinfo=startup, creationflags=subprocess.CREATE_NEW_CONSOLE)
  print(json.dumps({'pid': child.pid, 'creationFileTime': creation(child.pid)}))
elif mode in ('verify', 'ctrl-c', 'close-window'):
  pid = int(sys.argv[2])
  expected = sys.argv[3]
  if creation(pid) != expected:
    raise RuntimeError('PID 建立時間不符；拒絕發送主控台事件')
  if mode == 'verify':
    print(json.dumps({'pid': pid, 'creationVerified': True}))
    sys.exit(0)
  kernel.FreeConsole()
  if not kernel.AttachConsole(pid):
    raise ctypes.WinError(ctypes.get_last_error())
  try:
    if mode == 'ctrl-c':
      # helper 自己忽略 Ctrl+C；此 console 是 CREATE_NEW_CONSOLE 建立，與使用者 console 隔離。
      kernel.SetConsoleCtrlHandler(None, True)
      if not kernel.GenerateConsoleCtrlEvent(0, 0):
        raise ctypes.WinError(ctypes.get_last_error())
      time.sleep(0.3)
    else:
      window = kernel.GetConsoleWindow()
      if not window or not user.PostMessageW(window, 0x0010, 0, 0):
        raise RuntimeError('此測試 console 沒有可關閉的視窗')
    print(json.dumps({'event': mode, 'pid': pid, 'creationVerified': True, 'posted': True}))
  finally:
    kernel.FreeConsole()
else:
  raise RuntimeError('未知主控台操作')
