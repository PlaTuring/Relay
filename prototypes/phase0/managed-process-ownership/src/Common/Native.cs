using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;

namespace ManagedProcessOwnership
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct FILETIME_NATIVE
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;

        public long ToLong()
        {
            return unchecked((long)(((ulong)dwHighDateTime << 32) | dwLowDateTime));
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SOCKADDR_IN
    {
        public short sin_family;
        public ushort sin_port;
        public uint sin_addr;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
        public byte[] sin_zero;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    internal struct WSADATA
    {
        public short wVersion;
        public short wHighVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 257)]
        public string szDescription;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 129)]
        public string szSystemStatus;
        public short iMaxSockets;
        public short iMaxUdpDg;
        public IntPtr lpVendorInfo;
    }

    public static class NativeMethods
    {
        public const uint CREATE_SUSPENDED = 0x00000004;
        public const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
        public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        public const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        public const uint CREATE_NO_WINDOW = 0x08000000;
        public const uint JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x00000800;
        public const uint JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x00001000;
        public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        public const uint WAIT_OBJECT_0 = 0;
        public const uint WAIT_TIMEOUT = 258;
        public const uint PROCESS_TERMINATE = 0x0001;
        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public const uint SYNCHRONIZE = 0x00100000;
        public const int STARTF_USESTDHANDLES = 0x00000100;
        public const uint HANDLE_FLAG_INHERIT = 0x00000001;
        public const int JobObjectExtendedLimitInformation = 9;
        public static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = new IntPtr(0x00020002);
        public static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool QueryInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength, out uint returnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool GetProcessTimes(IntPtr process, out FILETIME_NATIVE creation, out FILETIME_NATIVE exit, out FILETIME_NATIVE kernel, out FILETIME_NATIVE user);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder path, ref int size);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SECURITY_ATTRIBUTES attributes, int size);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr CreateFile(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            ref SECURITY_ATTRIBUTES attributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, int flags, ref IntPtr size);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool UpdateProcThreadAttribute(
            IntPtr attributeList,
            uint flags,
            IntPtr attribute,
            IntPtr value,
            IntPtr size,
            IntPtr previousValue,
            IntPtr returnSize);

        [DllImport("kernel32.dll")]
        internal static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool CreateProcess(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFOEX startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool CreateProcessSimple(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int WSAStartup(ushort version, out WSADATA data);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern IntPtr WSASocket(int addressFamily, int socketType, int protocol, IntPtr protocolInfo, uint group, uint flags);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int bind(IntPtr socket, ref SOCKADDR_IN address, int addressLength);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int listen(IntPtr socket, int backlog);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int getsockname(IntPtr socket, ref SOCKADDR_IN address, ref int addressLength);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int setsockopt(IntPtr socket, int level, int optionName, ref int optionValue, int optionLength);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern IntPtr accept(IntPtr socket, IntPtr address, IntPtr addressLength);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int recv(IntPtr socket, byte[] buffer, int length, int flags);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int send(IntPtr socket, byte[] buffer, int length, int flags);

        [DllImport("ws2_32.dll", SetLastError = true)]
        internal static extern int closesocket(IntPtr socket);

        [DllImport("ws2_32.dll")]
        internal static extern int WSAGetLastError();
    }

    public sealed class JobObject : IDisposable
    {
        private IntPtr handle;

        private JobObject(IntPtr handle)
        {
            this.handle = handle;
        }

        public IntPtr Handle { get { return handle; } }

        public static JobObject Create(uint requestedFlags)
        {
            uint forbidden = NativeMethods.JOB_OBJECT_LIMIT_BREAKAWAY_OK | NativeMethods.JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
            if ((requestedFlags & forbidden) != 0 || requestedFlags != NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
            {
                throw new SafeProtocolException("JOB_FLAGS_REJECTED");
            }

            IntPtr job = NativeMethods.CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new SafeProtocolException("JOB_CREATE_FAILED");
            JobObject result = new JobObject(job);
            try
            {
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limits.BasicLimitInformation.LimitFlags = requestedFlags;
                int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(limits, buffer, false);
                    if (!NativeMethods.SetInformationJobObject(job, NativeMethods.JobObjectExtendedLimitInformation, buffer, (uint)size))
                    {
                        throw new SafeProtocolException("JOB_LIMIT_SET_FAILED");
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
                if (result.QueryLimitFlags() != NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
                {
                    throw new SafeProtocolException("JOB_LIMIT_VERIFY_FAILED");
                }
                return result;
            }
            catch
            {
                result.Dispose();
                throw;
            }
        }

        public uint QueryLimitFlags()
        {
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                uint returned;
                if (!NativeMethods.QueryInformationJobObject(handle, NativeMethods.JobObjectExtendedLimitInformation, buffer, (uint)size, out returned))
                {
                    throw new SafeProtocolException("JOB_LIMIT_QUERY_FAILED");
                }
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = (JOBOBJECT_EXTENDED_LIMIT_INFORMATION)Marshal.PtrToStructure(buffer, typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                return limits.BasicLimitInformation.LimitFlags;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public void Assign(IntPtr process)
        {
            if (!NativeMethods.AssignProcessToJobObject(handle, process))
            {
                throw new SafeProtocolException("JOB_ASSIGN_FAILED");
            }
        }

        public bool Contains(IntPtr process)
        {
            bool result;
            if (!NativeMethods.IsProcessInJob(process, handle, out result))
            {
                throw new SafeProtocolException("JOB_MEMBERSHIP_QUERY_FAILED");
            }
            return result;
        }

        public bool Terminate()
        {
            return NativeMethods.TerminateJobObject(handle, 0xE0010001);
        }

        public void Dispose()
        {
            if (handle != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(handle);
                handle = IntPtr.Zero;
            }
        }
    }

    public sealed class ReservedLoopbackSocket : IDisposable
    {
        private IntPtr handle;

        private ReservedLoopbackSocket(IntPtr handle, int port)
        {
            this.handle = handle;
            Port = port;
        }

        public IntPtr Handle { get { return handle; } }
        public int Port { get; private set; }

        public static ReservedLoopbackSocket Create(int requestedPort)
        {
            SocketNative.EnsureStarted();
            IntPtr socket = NativeMethods.WSASocket(2, 1, 6, IntPtr.Zero, 0, 0);
            if (socket == NativeMethods.INVALID_HANDLE_VALUE)
            {
                throw new SafeProtocolException("PORT_SOCKET_CREATE_FAILED");
            }
            ReservedLoopbackSocket result = null;
            try
            {
                int enabled = 1;
                if (NativeMethods.setsockopt(socket, 0xffff, unchecked((int)0xfffffffb), ref enabled, sizeof(int)) != 0)
                {
                    throw new SafeProtocolException("PORT_EXCLUSIVE_FLAG_FAILED");
                }
                SOCKADDR_IN address = SocketNative.LoopbackAddress(requestedPort);
                if (NativeMethods.bind(socket, ref address, Marshal.SizeOf(typeof(SOCKADDR_IN))) != 0)
                {
                    throw new SafeProtocolException("PORT_RESERVATION_FAILED");
                }
                if (NativeMethods.listen(socket, 8) != 0)
                {
                    throw new SafeProtocolException("PORT_LISTEN_FAILED");
                }
                int addressLength = Marshal.SizeOf(typeof(SOCKADDR_IN));
                if (NativeMethods.getsockname(socket, ref address, ref addressLength) != 0)
                {
                    throw new SafeProtocolException("PORT_QUERY_FAILED");
                }
                int port = (ushort)IPAddress.NetworkToHostOrder((short)address.sin_port);
                if (!NativeMethods.SetHandleInformation(socket, NativeMethods.HANDLE_FLAG_INHERIT, NativeMethods.HANDLE_FLAG_INHERIT))
                {
                    throw new SafeProtocolException("PORT_INHERIT_FLAG_FAILED");
                }
                result = new ReservedLoopbackSocket(socket, port);
                socket = IntPtr.Zero;
                return result;
            }
            finally
            {
                if (socket != IntPtr.Zero && socket != NativeMethods.INVALID_HANDLE_VALUE)
                {
                    NativeMethods.closesocket(socket);
                }
            }
        }

        public IntPtr RelinquishParentCopy()
        {
            IntPtr value = handle;
            if (handle != IntPtr.Zero)
            {
                NativeMethods.closesocket(handle);
                handle = IntPtr.Zero;
            }
            return value;
        }

        public void Dispose()
        {
            RelinquishParentCopy();
        }
    }

    public static class SocketNative
    {
        private static readonly object Gate = new object();
        private static bool started;

        public static void EnsureStarted()
        {
            lock (Gate)
            {
                if (started) return;
                WSADATA data;
                if (NativeMethods.WSAStartup(0x0202, out data) != 0)
                {
                    throw new SafeProtocolException("WINSOCK_START_FAILED");
                }
                started = true;
            }
        }

        internal static SOCKADDR_IN LoopbackAddress(int port)
        {
            byte[] bytes = IPAddress.Loopback.GetAddressBytes();
            return new SOCKADDR_IN
            {
                sin_family = 2,
                sin_port = (ushort)IPAddress.HostToNetworkOrder((short)port),
                sin_addr = BitConverter.ToUInt32(bytes, 0),
                sin_zero = new byte[8]
            };
        }

        public static void ServeInheritedListener(IntPtr listener, IDictionary<string, string> response, bool ignoreShutdown)
        {
            EnsureStarted();
            IntPtr client = NativeMethods.accept(listener, IntPtr.Zero, IntPtr.Zero);
            if (client == NativeMethods.INVALID_HANDLE_VALUE)
            {
                throw new SafeProtocolException("CHILD_ACCEPT_FAILED");
            }
            try
            {
                string hello = ReceiveLine(client, 1024);
                if (!string.Equals(hello, "HELLO", StringComparison.Ordinal))
                {
                    throw new SafeProtocolException("CHILD_HELLO_INVALID");
                }
                SendAll(client, Encoding.UTF8.GetBytes(WireProtocol.Encode(response)));
                string command = ReceiveLine(client, 1024);
                if (ignoreShutdown)
                {
                    System.Threading.Thread.Sleep(60000);
                    return;
                }
                if (!string.Equals(command, "SHUTDOWN", StringComparison.Ordinal))
                {
                    throw new SafeProtocolException("CHILD_SHUTDOWN_INVALID");
                }
            }
            finally
            {
                NativeMethods.closesocket(client);
                NativeMethods.closesocket(listener);
            }
        }

        private static string ReceiveLine(IntPtr socket, int limit)
        {
            List<byte> bytes = new List<byte>();
            byte[] one = new byte[1];
            while (bytes.Count < limit)
            {
                int count = NativeMethods.recv(socket, one, 1, 0);
                if (count <= 0) throw new SafeProtocolException("SOCKET_READ_FAILED");
                if (one[0] == 10) return Encoding.UTF8.GetString(bytes.ToArray()).TrimEnd('\r');
                bytes.Add(one[0]);
            }
            throw new SafeProtocolException("SOCKET_LINE_TOO_LONG");
        }

        private static void SendAll(IntPtr socket, byte[] bytes)
        {
            int offset = 0;
            while (offset < bytes.Length)
            {
                byte[] chunk = new byte[bytes.Length - offset];
                Buffer.BlockCopy(bytes, offset, chunk, 0, chunk.Length);
                int sent = NativeMethods.send(socket, chunk, chunk.Length, 0);
                if (sent <= 0) throw new SafeProtocolException("SOCKET_WRITE_FAILED");
                offset += sent;
            }
        }
    }

    public static class ProcessIdentityTools
    {
        public static ProcessIdentity Capture(IntPtr process, int processId)
        {
            FILETIME_NATIVE creation;
            FILETIME_NATIVE exit;
            FILETIME_NATIVE kernel;
            FILETIME_NATIVE user;
            if (!NativeMethods.GetProcessTimes(process, out creation, out exit, out kernel, out user))
            {
                throw new SafeProtocolException("PROCESS_TIME_QUERY_FAILED");
            }
            StringBuilder image = new StringBuilder(32768);
            int length = image.Capacity;
            if (!NativeMethods.QueryFullProcessImageName(process, 0, image, ref length))
            {
                throw new SafeProtocolException("PROCESS_IMAGE_QUERY_FAILED");
            }
            string canonical = Path.GetFullPath(image.ToString());
            return new ProcessIdentity
            {
                ProcessId = processId,
                CreationFileTime = creation.ToLong(),
                ParentProcessId = GetParentProcessId(processId),
                CanonicalImagePath = canonical,
                ImageSha256 = IdentityTools.Sha256File(canonical)
            };
        }

        public static ProcessIdentity CaptureByPid(int processId)
        {
            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION | NativeMethods.SYNCHRONIZE,
                false,
                processId);
            if (process == IntPtr.Zero) throw new SafeProtocolException("PROCESS_OPEN_FAILED");
            try
            {
                return Capture(process, processId);
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }

        public static bool IsSameLiveProcess(ProcessIdentity expected)
        {
            if (expected == null) return false;
            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION | NativeMethods.SYNCHRONIZE,
                false,
                expected.ProcessId);
            if (process == IntPtr.Zero) return false;
            try
            {
                if (NativeMethods.WaitForSingleObject(process, 0) != NativeMethods.WAIT_TIMEOUT) return false;
                ProcessIdentity actual = Capture(process, expected.ProcessId);
                return actual.CreationFileTime == expected.CreationFileTime
                    && string.Equals(actual.CanonicalImagePath, expected.CanonicalImagePath, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(actual.ImageSha256, expected.ImageSha256, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }

        public static bool IsPidWithCreationLive(int processId, long creationFileTime)
        {
            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION | NativeMethods.SYNCHRONIZE,
                false,
                processId);
            if (process == IntPtr.Zero) return false;
            try
            {
                FILETIME_NATIVE creation;
                FILETIME_NATIVE exit;
                FILETIME_NATIVE kernel;
                FILETIME_NATIVE user;
                return NativeMethods.GetProcessTimes(process, out creation, out exit, out kernel, out user)
                    && creation.ToLong() == creationFileTime
                    && NativeMethods.WaitForSingleObject(process, 0) == NativeMethods.WAIT_TIMEOUT;
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }

        public static int GetParentProcessId(int processId)
        {
            IntPtr snapshot = NativeMethods.CreateToolhelp32Snapshot(0x00000002, 0);
            if (snapshot == NativeMethods.INVALID_HANDLE_VALUE) return -1;
            try
            {
                PROCESSENTRY32 entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (NativeMethods.Process32First(snapshot, ref entry))
                {
                    do
                    {
                        if (entry.th32ProcessID == (uint)processId)
                        {
                            return unchecked((int)entry.th32ParentProcessID);
                        }
                    }
                    while (NativeMethods.Process32Next(snapshot, ref entry));
                }
                return -1;
            }
            finally
            {
                NativeMethods.CloseHandle(snapshot);
            }
        }

        public static bool IsCurrentProcessInAnyJob()
        {
            bool result;
            if (!NativeMethods.IsProcessInJob(Process.GetCurrentProcess().Handle, IntPtr.Zero, out result))
            {
                throw new SafeProtocolException("CURRENT_JOB_QUERY_FAILED");
            }
            return result;
        }
    }

    public static class OwnedStop
    {
        public static bool TryTerminateVerifiedJob(JobObject job, ProcessIdentity expectedRoot)
        {
            if (job == null || expectedRoot == null) return false;
            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION | NativeMethods.PROCESS_TERMINATE | NativeMethods.SYNCHRONIZE,
                false,
                expectedRoot.ProcessId);
            if (process == IntPtr.Zero) return false;
            try
            {
                ProcessIdentity actual = ProcessIdentityTools.Capture(process, expectedRoot.ProcessId);
                if (actual.CreationFileTime != expectedRoot.CreationFileTime) return false;
                if (!string.Equals(actual.CanonicalImagePath, expectedRoot.CanonicalImagePath, StringComparison.OrdinalIgnoreCase)) return false;
                if (!string.Equals(actual.ImageSha256, expectedRoot.ImageSha256, StringComparison.OrdinalIgnoreCase)) return false;
                if (!job.Contains(process)) return false;
                return job.Terminate();
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }

        public static bool TryTerminateExactProcess(ProcessIdentity expected)
        {
            if (expected == null) return false;
            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION | NativeMethods.PROCESS_TERMINATE | NativeMethods.SYNCHRONIZE,
                false,
                expected.ProcessId);
            if (process == IntPtr.Zero) return false;
            try
            {
                ProcessIdentity actual = ProcessIdentityTools.Capture(process, expected.ProcessId);
                if (actual.CreationFileTime != expected.CreationFileTime) return false;
                if (!string.Equals(actual.CanonicalImagePath, expected.CanonicalImagePath, StringComparison.OrdinalIgnoreCase)) return false;
                if (!string.Equals(actual.ImageSha256, expected.ImageSha256, StringComparison.OrdinalIgnoreCase)) return false;
                bool terminated = NativeMethods.TerminateProcess(process, 0xE0010002);
                if (terminated) NativeMethods.WaitForSingleObject(process, 5000);
                return terminated;
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }
    }

    public static class TestNative
    {
        public static bool IsPidInJob(int processId, JobObject job)
        {
            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION | NativeMethods.SYNCHRONIZE,
                false,
                processId);
            if (process == IntPtr.Zero) return false;
            try
            {
                return job.Contains(process);
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }

        public static bool IsBreakawayCreateDeniedByJob(string executablePath)
        {
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            PROCESS_INFORMATION process;
            StringBuilder command = new StringBuilder(WindowsCommandLine.Join(new[]
            {
                executablePath,
                "--mode",
                "grandchild"
            }));
            bool created = NativeMethods.CreateProcessSimple(
                executablePath,
                command,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                NativeMethods.CREATE_SUSPENDED | NativeMethods.CREATE_BREAKAWAY_FROM_JOB | NativeMethods.CREATE_NO_WINDOW,
                IntPtr.Zero,
                Path.GetDirectoryName(executablePath),
                ref startup,
                out process);
            if (!created)
            {
                return Marshal.GetLastWin32Error() == 5;
            }
            try
            {
                NativeMethods.TerminateProcess(process.hProcess, 0xE0010003);
                NativeMethods.WaitForSingleObject(process.hProcess, 5000);
                return false;
            }
            finally
            {
                NativeMethods.CloseHandle(process.hThread);
                NativeMethods.CloseHandle(process.hProcess);
            }
        }

        public static ProcessIdentity StartOrdinaryProcess(string executablePath, IEnumerable<string> arguments)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = executablePath;
            info.Arguments = WindowsCommandLine.Join(arguments);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            Process process = Process.Start(info);
            try
            {
                return ProcessIdentityTools.Capture(process.Handle, process.Id);
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    public static class WindowsCommandLine
    {
        public static string Join(IEnumerable<string> arguments)
        {
            StringBuilder result = new StringBuilder();
            bool first = true;
            foreach (string argument in arguments)
            {
                if (!first) result.Append(' ');
                result.Append(Quote(argument ?? string.Empty));
                first = false;
            }
            return result.ToString();
        }

        private static string Quote(string argument)
        {
            if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                return argument;
            }
            StringBuilder result = new StringBuilder();
            result.Append('"');
            int slashes = 0;
            for (int index = 0; index < argument.Length; index++)
            {
                char character = argument[index];
                if (character == '\\')
                {
                    slashes++;
                }
                else if (character == '"')
                {
                    result.Append('\\', slashes * 2 + 1);
                    result.Append('"');
                    slashes = 0;
                }
                else
                {
                    result.Append('\\', slashes);
                    slashes = 0;
                    result.Append(character);
                }
            }
            result.Append('\\', slashes * 2);
            result.Append('"');
            return result.ToString();
        }
    }
}
