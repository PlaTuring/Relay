// Uncompiled design fixture: path-shape policy is not a fixed-NTFS/reparse security proof.
using System;

namespace MiniMaxH3.StackDotnet.Fixture;

internal static class ManagedRootPolicy
{
    internal static ManagedRootResult Inspect(string candidate, string systemDrive)
    {
        if (string.IsNullOrEmpty(candidate) ||
            candidate.Length > 32767 ||
            candidate.IndexOf('\0') >= 0 ||
            candidate.StartsWith(@"\\", StringComparison.Ordinal) ||
            candidate.Length < 3 ||
            !char.IsAsciiLetter(candidate[0]) ||
            candidate[1] != ':' ||
            (candidate[2] != '\\' && candidate[2] != '/'))
        {
            return new ManagedRootResult(
                false, null, null, false, false, false, "UNSUPPORTED_PATH_SHAPE");
        }

        string drive = char.ToUpperInvariant(candidate[0]) + ":";
        return new ManagedRootResult(
            true,
            candidate,
            drive,
            string.Equals(drive, systemDrive.Trim(), StringComparison.OrdinalIgnoreCase),
            candidate.IndexOf(' ') >= 0,
            ContainsNonAscii(candidate),
            null);
    }

    internal static string? Suggest(bool supportedFixedNtfsDriveD)
    {
        return supportedFixedNtfsDriveD ? @"D:\MiniMaxH3" : null;
    }

    private static bool ContainsNonAscii(string value)
    {
        foreach (char character in value)
        {
            if (character > 127)
            {
                return true;
            }
        }
        return false;
    }
}

