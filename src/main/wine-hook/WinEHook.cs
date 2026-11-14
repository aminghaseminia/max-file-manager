// Max File Manager — Win+E takeover helper.
//
// Windows 10/11 handles Win+E inside explorer.exe, and the key cannot be claimed with
// RegisterHotKey (Electron's globalShortcut reports failure for Super+E for exactly that reason).
// The only route left is a low-level keyboard hook — the same thing Directory Opus installs for
// its "Launching Opus from the Win+E hotkey" feature. This process owns that hook: it swallows the
// keystroke and starts the app, which then either raises its window (single instance) or opens a new one.
//
// Built by scripts/build-wine-hook.mjs with the csc.exe that ships with the .NET Framework, so it
// needs no compiler and no runtime install.

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class WinEHook
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int VK_E = 0x45;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private static readonly HookProc Proc = HookCallback;
    private static IntPtr _hook = IntPtr.Zero;
    private static string _target = "";
    private static string _log = "";
    private static string _args = "";
    private static int _parentPid;
    private static volatile bool _swallowed;

    private static void Note(string message)
    {
        if (_log.Length == 0) return;
        try { File.AppendAllText(_log, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + Environment.NewLine); }
        catch { /* logging must never take the hook down */ }
    }

    private static bool WinDown()
    {
        return (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
        {
            KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if (info.vkCode == VK_E && !_swallowed && WinDown())
            {
                _swallowed = true;
                Note("swallowed Win+E");
                Fire();
                return (IntPtr)1; // eat the keystroke: Explorer never sees it
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    private static void Fire()
    {
        try
        {
            if (_target.Length == 0)
            {
                Note("fired with no target");
                return;
            }
            ProcessStartInfo psi = new ProcessStartInfo(_target);
            psi.UseShellExecute = true;
            if (_args.Length > 0) psi.Arguments = _args;
            Process.Start(psi);
            Note("started " + _target);
        }
        catch (Exception e)
        {
            Note("start failed: " + e.Message);
        }
    }

    [STAThread]
    private static void Main(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--target":
                    if (i + 1 < args.Length) _target = args[++i];
                    break;
                case "--log":
                    if (i + 1 < args.Length) _log = args[++i];
                    break;
                case "--args":
                    if (i + 1 < args.Length) _args = args[++i];
                    break;
                case "--parent":
                    if (i + 1 < args.Length) int.TryParse(args[++i], out _parentPid);
                    break;
            }
        }

        bool created;
        using (Mutex single = new Mutex(true, "Local\\MaxFileManagerWinEHook", out created))
        {
            if (!created) return; // one hook per session; a second one would launch the app twice

            _hook = SetWindowsHookEx(WH_KEYBOARD_LL, Proc, GetModuleHandle(null), 0);
            Note("hook=" + _hook + " target=" + _target);
            if (_hook == IntPtr.Zero)
            {
                Note("SetWindowsHookEx failed err=" + Marshal.GetLastWin32Error());
                return;
            }

            // Arm again once the key is physically released, so a held key does not repeat.
            System.Threading.Timer rearm = new System.Threading.Timer(
                delegate { if ((GetAsyncKeyState(VK_E) & 0x8000) == 0) _swallowed = false; }, null, 0, 40);
            GC.KeepAlive(rearm);

            if (_parentPid > 0)
            {
                // The app owns this process: when it goes away (quit, crash, upgrade) so do we.
                System.Threading.Timer watchdog = new System.Threading.Timer(delegate
                {
                    try { Process.GetProcessById(_parentPid); }
                    catch { Note("parent gone"); Environment.Exit(0); }
                }, null, 2000, 2000);
                GC.KeepAlive(watchdog);
            }

            Application.EnableVisualStyles();
            Application.Run();
            UnhookWindowsHookEx(_hook);
        }
    }
}
