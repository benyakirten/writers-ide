#requires -Version 5.1
<#
Build-only attribution helper. Run from an ordinary Windows PowerShell session:
  powershell.exe -NoProfile -File .\tooling\registry-windows-conformance\build.ps1
Keep source files and the installed toolchain unchanged throughout this build.
Before/after identities are endpoint observations. They cannot detect changes
that are restored between observations or defend against concurrent/hostile changes.
The record is not authenticated provenance or independent binary reproduction.
The success stream returns one private operator-only object with Executable.
No test executable or native fixture entry is executed by this script.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Use .NET pipe readers rather than PowerShell native pipelines. Both streams are
# drained concurrently, including while waiting for cargo, with one shared budget.
$helperSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace RegistryConformanceBuild {
    public sealed class Failure : Exception {
        public Failure(string message) : base(message) { }
    }

    public sealed class Capture {
        public byte[] Stdout;
        public byte[] Stderr;
        public int ExitCode;
    }

    public static class Tools {
        private const int OutputLimit = 8 * 1024 * 1024;
        private static int outputBytes;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        public static string Text(byte[] bytes) { return Utf8.GetString(bytes); }

        private static async Task Drain(Stream input, MemoryStream output) {
            byte[] buffer = new byte[8192];
            while (true) {
                int count = await input.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                if (count == 0) { return; }
                if (Interlocked.Add(ref outputBytes, count) > OutputLimit) {
                    throw new Failure("Aggregate tool output exceeded 8 MiB; no record was admitted.");
                }
                output.Write(buffer, 0, count);
            }
        }

        public static Capture Run(string tool, string arguments, string directory,
                                  int seconds, IDictionary<string, string> environment) {
            using (Process process = new Process())
            using (MemoryStream stdout = new MemoryStream())
            using (MemoryStream stderr = new MemoryStream()) {
                process.StartInfo = new ProcessStartInfo(tool, arguments) {
                    WorkingDirectory = directory, UseShellExecute = false,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    CreateNoWindow = true
                };
                if (environment != null) {
                    foreach (KeyValuePair<string, string> entry in environment) {
                        process.StartInfo.EnvironmentVariables[entry.Key] = entry.Value;
                    }
                }
                try {
                    if (!process.Start()) { throw new Failure("Tool did not start."); }
                } catch {
                    throw new Failure("Could not start required tool. Check installed cargo, git and rustc and PATH.");
                }
                Task outTask = Drain(process.StandardOutput.BaseStream, stdout);
                Task errTask = Drain(process.StandardError.BaseStream, stderr);
                Stopwatch clock = Stopwatch.StartNew();
                string failure = null;
                while (true) {
                    if (outTask.IsFaulted || errTask.IsFaulted) {
                        failure = "Tool capture failed or aggregate output exceeded 8 MiB.";
                        break;
                    }
                    if (process.HasExited && outTask.IsCompleted && errTask.IsCompleted) { break; }
                    if (clock.Elapsed.TotalSeconds >= seconds) {
                        failure = "Tool deadline exceeded (cargo: 600 seconds; other tools: 30 seconds).";
                        break;
                    }
                    Thread.Sleep(20);
                }
                if (failure != null) {
                    // Bound termination and reap attempts too. Do not use parameterless
                    // WaitForExit: inherited pipes can remain open in descendants.
                    Task terminate = Task.Run(() => {
                        try { if (!process.HasExited) { process.Kill(); } } catch { }
                        try { process.WaitForExit(3000); } catch { }
                    });
                    bool settled = terminate.Wait(5000);
                    bool reaped = settled && process.HasExited;
                    throw new Failure(failure + (reaped
                        ? " Child reaped; cargo descendants may still need operator inspection. No record written."
                        : " Child termination/reaping unresolved; inspect build processes manually. No record written."));
                }
                return new Capture { Stdout = stdout.ToArray(), Stderr = stderr.ToArray(), ExitCode = process.ExitCode };
            }
        }

        public static void CheckPath(string path, bool directory) {
            string full = Path.GetFullPath(path);
            string cursor = full;
            while (!String.IsNullOrEmpty(cursor)) {
                FileAttributes attributes = File.GetAttributes(cursor);
                if ((attributes & FileAttributes.ReparsePoint) != 0) {
                    throw new Failure("Reparse points are not permitted in build input/output paths.");
                }
                if (cursor == full && (((attributes & FileAttributes.Directory) != 0) != directory)) {
                    throw new Failure("Expected a regular file or directory was not found.");
                }
                cursor = Path.GetDirectoryName(cursor);
            }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateDirectoryW(string path, IntPtr securityAttributes);

        public static string CreateFreshTarget(string parent) {
            Directory.CreateDirectory(parent);
            CheckPath(parent, true);
            string path = Path.Combine(parent, "build-" + Guid.NewGuid().ToString("N"));
            // Unlike Directory.CreateDirectory, Win32 directory creation refuses
            // an existing name. Do not retry or reuse an earlier build directory.
            if (!CreateDirectoryW(path, IntPtr.Zero)) {
                throw new Failure("Exclusive fresh build-directory admission failed. No cache was reused or deleted.");
            }
            CheckPath(path, true);
            return path;
        }

        public static string Hex(byte[] digest) {
            return BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
        }

        public static string HashExecutable(string path) {
            CheckPath(path, false);
            using (FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (SHA256 hash = SHA256.Create()) { return Hex(hash.ComputeHash(file)); }
        }

        private static void Feed(HashAlgorithm hash, byte[] bytes) {
            hash.TransformBlock(bytes, 0, bytes.Length, bytes, 0);
        }

        private static void Length(HashAlgorithm hash, long value) {
            // Explicit little-endian u64 framing, independent of machine endianness.
            byte[] bytes = new byte[8];
            for (int i = 0; i < 8; i++) { bytes[i] = (byte)((ulong)value >> (8 * i)); }
            Feed(hash, bytes);
        }

        public static string Fingerprint(string root, byte[] listing) {
            string[] entries = Text(listing).Split(new char[] { '\0' }, StringSplitOptions.RemoveEmptyEntries);
            SortedSet<string> names = new SortedSet<string>(entries, StringComparer.Ordinal);
            if (names.Count > 10000) { throw new Failure("Source listing exceeds 10000 files."); }
            string boundary = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            Dictionary<string, string> windowsNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            Dictionary<string, string> paths = new Dictionary<string, string>(StringComparer.Ordinal);
            // Validate the complete listing before reading or hashing any source.
            // Check prefixes too: Dir/a and dir/b are Windows-equivalent directories.
            foreach (string name in names) {
                if (Path.IsPathRooted(name) || name.Contains("\\") || name.Contains(":")) {
                    throw new Failure("Invalid project-relative source name.");
                }
                string prefix = "";
                foreach (string part in name.Split('/')) {
                    if (part == "" || part == "." || part == ".." || part.EndsWith(".", StringComparison.Ordinal) ||
                        part.EndsWith(" ", StringComparison.Ordinal) || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) {
                        throw new Failure("Source name is not an unambiguous Windows path.");
                    }
                    string basename = part.Split('.')[0].TrimEnd(' ');
                    if (Regex.IsMatch(basename, @"\A(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) {
                        throw new Failure("Reserved Windows device source names are not permitted.");
                    }
                    prefix = prefix.Length == 0 ? part : prefix + "/" + part;
                    string previous;
                    if (windowsNames.TryGetValue(prefix, out previous) && !String.Equals(prefix, previous, StringComparison.Ordinal)) {
                        throw new Failure("Windows-equivalent case-insensitive source paths collide.");
                    }
                    windowsNames[prefix] = prefix;
                }
                string path = Path.GetFullPath(Path.Combine(root, name.Replace('/', Path.DirectorySeparatorChar)));
                if (!path.StartsWith(boundary, StringComparison.OrdinalIgnoreCase)) {
                    throw new Failure("Normalized source path is outside the project root.");
                }
                paths.Add(name, path);
            }
            long total = 0;
            using (SHA256 hash = SHA256.Create()) {
                Feed(hash, Utf8.GetBytes("writers-ide.actual-source-tree/1\0"));
                foreach (string name in names) {
                    string path = paths[name];
                    // Tracked deletions have no actual bytes. Their absence is also
                    // represented by the file set and Git's dirty observation.
                    try { File.GetAttributes(path); }
                    catch (FileNotFoundException) { continue; }
                    catch (DirectoryNotFoundException) { continue; }
                    CheckPath(path, false); // Refuse symlinks, junctions and submodules.
                    using (FileStream file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                        long length = file.Length;
                        total = checked(total + length);
                        if (total > 256L * 1024 * 1024) {
                            throw new Failure("Actual source bytes exceed 256 MiB.");
                        }
                        byte[] relative = Utf8.GetBytes(name);
                        Length(hash, relative.Length);
                        Feed(hash, relative);
                        Length(hash, length);
                        byte[] buffer = new byte[65536];
                        long read = 0;
                        while (true) {
                            int count = file.Read(buffer, 0, buffer.Length);
                            if (count == 0) { break; }
                            read += count;
                            if (read > length) { throw new Failure("Source changed during fingerprinting."); }
                            hash.TransformBlock(buffer, 0, count, buffer, 0);
                        }
                        if (read != length) { throw new Failure("Source changed during fingerprinting."); }
                    }
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                return Hex(hash.Hash);
            }
        }

        public static void WriteRecord(string path, byte[] bytes) {
            // Publish only a complete, flushed record. File.Move refuses an
            // existing destination; a failed write cannot leave partial final JSON.
            string temporary = Path.Combine(Path.GetDirectoryName(path), ".build-record-" + Guid.NewGuid().ToString("N") + ".tmp");
            bool owned = false;
            try {
                using (FileStream file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    owned = true;
                    file.Write(bytes, 0, bytes.Length);
                    file.Flush(true);
                }
                File.Move(temporary, path);
                owned = false;
            } finally {
                if (owned) { File.Delete(temporary); }
            }
        }
    }
}
'@

$stage = 'Windows and ordinary-user token preflight'
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This build helper requires Windows. No build or fixture was run.'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Refusing an elevated Windows token. Open an ordinary-user PowerShell session.'
        }
    } finally {
        $identity.Dispose()
    }
    if ($args.Count -ne 0) { throw 'This helper accepts no arguments or storage paths.' }
    $stage = 'compiling the installed .NET helper'
    Add-Type -TypeDefinition $helperSource -Language CSharp

    $repo = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..'))
    $native = [IO.Path]::Combine($repo, 'src-tauri')
    $target = [IO.Path]::Combine($native, 'target')
    $output = [IO.Path]::Combine($target, 'registry-windows-conformance')
    $buildRoot = [IO.Path]::Combine($target, 'registry-windows-conformance-build')
    [RegistryConformanceBuild.Tools]::CheckPath($repo, $true)
    [RegistryConformanceBuild.Tools]::CheckPath($native, $true)

    $stage = 'resolving installed cargo, git and rustc'
    $git = (Get-Command git.exe -CommandType Application -ErrorAction Stop).Source
    $cargo = (Get-Command cargo.exe -CommandType Application -ErrorAction Stop).Source
    $rustc = (Get-Command rustc.exe -CommandType Application -ErrorAction Stop).Source
    $environment = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    # Pin the compiler invocation and output location over Cargo configuration.
    # Wrappers could substitute another compiler, so disable them for this build.
    $environment['RUSTC'] = $rustc
    $environment['CARGO_BUILD_RUSTC'] = $rustc
    $environment['RUSTC_WRAPPER'] = ''
    $environment['RUSTC_WORKSPACE_WRAPPER'] = ''
    $environment['CARGO_BUILD_RUSTC_WRAPPER'] = ''
    $environment['CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER'] = ''
    $environment['CARGO_BUILD_JOBS'] = '2'
    $environment['GIT_OPTIONAL_LOCKS'] = '0'

    function Invoke-CheckedTool([string] $Tool, [string] $Arguments, [int] $Seconds = 30) {
        $result = [RegistryConformanceBuild.Tools]::Run($Tool, $Arguments, $native, $Seconds, $environment)
        if ($result.ExitCode -ne 0) {
            # Tool diagnostics can contain local paths, environment values or secrets.
            throw ('{0} failed with exit code {1}. No record written. Check the tool locally; raw output is not retained.' -f [IO.Path]::GetFileName($Tool), $result.ExitCode)
        }
        return ,$result.Stdout
    }

    function Get-CompilerIdentity {
        $text = [RegistryConformanceBuild.Tools]::Text((Invoke-CheckedTool $rustc '-vV'))
        $fields = [ordered]@{}
        foreach ($key in @('release', 'commit-hash', 'host', 'LLVM version')) {
            $matches = [regex]::Matches($text, '(?m)^' + [regex]::Escape($key) + ': ([^\r\n]+)\r?$')
            if ($matches.Count -ne 1) { throw 'rustc -vV is missing an unambiguous required identity field.' }
            $value = $matches[0].Groups[1].Value
            # Match the parent's field-specific validation exactly.
            $valid = $false
            switch ($key) {
                'commit-hash' { $valid = $value -cmatch '\A[0-9a-f]{40}\z' }
                'host' {
                    $valid = $value.Length -le 128 -and $value -cmatch '\A[A-Za-z0-9._-]+\z' -and $value.Contains('-windows-')
                }
                default { $valid = $value.Length -le 128 -and $value -cmatch '\A[A-Za-z0-9.+_-]+\z' }
            }
            if (-not $valid) { throw 'rustc identity does not satisfy the required field-specific metadata rules.' }
            $fields[$key] = $value
        }

        return $fields
    }

    function Get-SourceIdentity {
        $revision = [RegistryConformanceBuild.Tools]::Text((Invoke-CheckedTool $git '--no-pager rev-parse --verify HEAD')).Trim()
        if ($revision -cnotmatch '^[0-9a-f]{40}$') { throw 'Expected a 40-character lowercase Git revision.' }
        $status = Invoke-CheckedTool $git '--no-pager status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none'
        $listing = Invoke-CheckedTool $git '--no-pager ls-files --cached --others --exclude-standard -z --full-name -- :/'
        return [pscustomobject]@{
            Revision = $revision
            Dirty = ($status.Length -ne 0)
            Tree = [RegistryConformanceBuild.Tools]::Fingerprint($repo, $listing)
        }
    }

    # Verify the derived checkout and ignored output boundary before any build.
    $stage = 'verifying the checkout root and ignored output boundary'
    $top = [RegistryConformanceBuild.Tools]::Text((Invoke-CheckedTool $git '--no-pager rev-parse --show-toplevel')).Trim()
    if (-not [string]::Equals([IO.Path]::GetFullPath($top), $repo, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Script location does not identify the Git checkout root.'
    }
    $ignoreCheck = [RegistryConformanceBuild.Tools]::Run($git, '--no-pager check-ignore -q --no-index -- target/registry-windows-conformance/build-boundary.json', $native, 30, $environment)
    if ($ignoreCheck.ExitCode -ne 0) {
        throw 'Git could not confirm that src-tauri/target/registry-windows-conformance is ignored. Refusing the build.'
    }
    if ([IO.Directory]::Exists($target)) { [RegistryConformanceBuild.Tools]::CheckPath($target, $true) }
    if ([IO.Directory]::Exists($output)) { [RegistryConformanceBuild.Tools]::CheckPath($output, $true) }

    $buildIgnoreCheck = [RegistryConformanceBuild.Tools]::Run($git, '--no-pager check-ignore -q --no-index -- target/registry-windows-conformance-build/build-boundary', $native, 30, $environment)
    if ($buildIgnoreCheck.ExitCode -ne 0) {
        throw 'Git could not confirm that the fixed fresh-build directory is ignored. Refusing the build.'
    }
    $stage = 'exclusively admitting a fresh Cargo target directory'
    $buildTarget = [RegistryConformanceBuild.Tools]::CreateFreshTarget($buildRoot)
    $environment['CARGO_TARGET_DIR'] = $buildTarget
    # Newer Cargo versions can place intermediate artifacts in a separate build
    # directory. Override that setting too, so no timestamp cache is reused.
    $environment['CARGO_BUILD_BUILD_DIR'] = $buildTarget
    Write-Host 'Required: do not edit project files or change the installed toolchain during this build.'
    Write-Host 'Before/after checks are endpoint observations only, not protection against concurrent or hostile changes.'
    $stage = 'capturing pre-build compiler and project source endpoint observations'
    $compilerBefore = Get-CompilerIdentity
    $sourceBefore = Get-SourceIdentity
    Write-Host 'Building library tests only (600-second deadline); no test entry will execute.'
    $stage = 'building library tests with cargo (no execution)'
    $cargoOutput = Invoke-CheckedTool $cargo 'test --locked --lib --no-run --message-format=json' 600
    $stage = 'checking post-build compiler and project source endpoint observations'
    $compilerAfter = Get-CompilerIdentity
    $sourceAfter = Get-SourceIdentity
    foreach ($key in $compilerBefore.Keys) {
        if ($compilerBefore[$key] -cne $compilerAfter[$key]) { throw 'Compiler identity changed during the build; refusing attribution.' }
    }
    if ($sourceBefore.Revision -cne $sourceAfter.Revision -or
        $sourceBefore.Dirty -ne $sourceAfter.Dirty -or
        $sourceBefore.Tree -cne $sourceAfter.Tree) {
        throw 'Project source changed during the build; refusing attribution. Build again with stable inputs.'
    }

    $stage = 'validating Cargo artifact identity and executable boundary'
    $executables = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in ([RegistryConformanceBuild.Tools]::Text($cargoOutput) -split "`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $record = ConvertFrom-Json -InputObject $line -ErrorAction Stop } catch {
            throw 'Cargo stdout contains malformed JSON; refusing artifact attribution.'
        }
        if ($record.reason -eq 'compiler-artifact' -and
            $record.target.name -eq 'writers_ide_lib' -and
            $record.profile.test -is [bool] -and $record.profile.test -and
            $null -ne $record.executable) {
            if ($record.executable -isnot [string]) { throw 'Cargo executable must be a string.' }
            $null = $executables.Add($record.executable)
        }
    }
    if ($executables.Count -ne 1) { throw 'Cargo must identify exactly one writers_ide_lib test executable.' }
    $executable = @($executables)[0]
    if (-not [IO.Path]::IsPathRooted($executable)) { throw 'Cargo executable path must be absolute.' }
    $executable = [IO.Path]::GetFullPath($executable)
    if (-not $executable.StartsWith($buildTarget + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetExtension($executable) -ine '.exe' -or $executable.IndexOf(':', 2) -ge 0) {
        throw 'Cargo executable must be an ordinary .exe inside this invocation''s exclusively admitted fresh target directory.'
    }
    $exeHash = [RegistryConformanceBuild.Tools]::HashExecutable($executable)
    $manifest = [ordered]@{
        schema = 'writers-ide.registry-windows-conformance-build/1'
        source_revision = $sourceBefore.Revision
        source_dirty = [bool]$sourceBefore.Dirty
        source_tree_sha256 = $sourceBefore.Tree
        rustc = $compilerBefore
        executable_sha256 = $exeHash
    }
    $stage = 'creating the exclusive build record in the fixed ignored output directory'
    $json = ConvertTo-Json -InputObject $manifest -Depth 4 -Compress
    $null = [IO.Directory]::CreateDirectory($output)
    [RegistryConformanceBuild.Tools]::CheckPath($output, $true)
    $recordPath = [IO.Path]::Combine($output, 'build-' + $exeHash + '.json')
    if ([IO.File]::Exists($recordPath) -or [IO.Directory]::Exists($recordPath)) {
        throw 'A record for this executable already exists. Refusing overwrite or conflicting attribution; inspect the existing record.'
    }
    # Recheck after source observation and record preparation. Admission in the
    # fixture must independently rehash the executable before any native run.
    if ([RegistryConformanceBuild.Tools]::HashExecutable($executable) -cne $exeHash) {
        throw 'Test executable changed before record creation; refusing attribution.'
    }
    [RegistryConformanceBuild.Tools]::WriteRecord($recordPath, [Text.UTF8Encoding]::new($false).GetBytes($json + "`n"))
    Write-Host ('Recorded build attribution: src-tauri/target/registry-windows-conformance/build-' + $exeHash + '.json')
    Write-Host 'This records cooperative endpoint observations, not authenticated provenance or independent binary reproduction. No fixture was run.'
    # Private operator output, deliberately separate from the shareable record.
    [pscustomobject]@{ Executable = $executable }
} catch {
    # Do not echo arbitrary OS/tool exceptions: their messages can expose paths.
    $message = 'Build helper failed during ' + $stage + '. Check installed tools, directory permissions and the fixed output boundary. No executable was run.'
    $baseException = $_.Exception.GetBaseException()
    if ($baseException.GetType().FullName -eq 'RegistryConformanceBuild.Failure') {
        $message = $baseException.Message
    }
    # Only explicit script refusals are safe to print. Suppress arbitrary .NET
    # and native diagnostics, which can include private absolute paths.
    if ($_.Exception -is [System.Management.Automation.RuntimeException] -and
        -not $_.Exception.InnerException -and
        $_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::OperationStopped) {
        $message = $_.Exception.Message
    }
    Write-Error -Message $message -ErrorAction Continue
    exit 1
}
