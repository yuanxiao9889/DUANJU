[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repoRoot "package.json"
$nodeScriptPath = Join-Path $PSScriptRoot "package-windows.mjs"
$artifactDirectory = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
$uiLogPath = Join-Path $repoRoot "package-windows-ui.log"
$semverPattern = '^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'

$script:packageProcess = $null
$script:isPackaging = $false
$script:currentVersion = ""
$script:lastArtifactPath = ""
$script:receivedDoneEvent = $false

function Write-UiLog {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  try {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $uiLogPath -Value "[$timestamp] $Message" -Encoding UTF8
  } catch {
    # Ignore log write failures so the UI can continue to run.
  }
}

$threadExceptionHandler = [System.Threading.ThreadExceptionEventHandler]{
  param($sender, $eventArgs)
  $exceptionText = if ($null -ne $eventArgs.Exception) {
    $eventArgs.Exception.ToString()
  } else {
    "Unknown UI thread exception."
  }
  Write-UiLog ("WinForms ThreadException: {0}" -f $exceptionText)
  [System.Windows.Forms.MessageBox]::Show(
    "打包窗口发生异常：`n$exceptionText`n`n详细日志：`n$uiLogPath",
    "窗口异常",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}
[System.Windows.Forms.Application]::add_ThreadException($threadExceptionHandler)

$unhandledExceptionHandler = [System.UnhandledExceptionEventHandler]{
  param($sender, $eventArgs)
  $exceptionText = if ($null -ne $eventArgs.ExceptionObject) {
    $eventArgs.ExceptionObject.ToString()
  } else {
    "Unknown unhandled exception."
  }
  Write-UiLog ("AppDomain UnhandledException: {0}" -f $exceptionText)
}
[System.AppDomain]::CurrentDomain.add_UnhandledException($unhandledExceptionHandler)

function Invoke-OnUiThread {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Action
  )

  if ($null -eq $form -or $form.IsDisposed) {
    Write-UiLog "UI invoke skipped because the form is already disposed."
    return
  }

  try {
    $null = $form.BeginInvoke($Action)
  } catch {
    Write-UiLog ("UI invoke failed: {0}" -f $_.Exception.ToString())
  }
}

function Get-CurrentVersion {
  $packageJson = Get-Content -Raw -Encoding UTF8 $packageJsonPath | ConvertFrom-Json
  if (-not $packageJson.version) {
    throw "package.json 中缺少 version 字段。"
  }

  return [string]$packageJson.version
}

function Convert-VersionToParts {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  $coreVersion = $Version.Split("-", 2)[0]
  $parts = $coreVersion.Split(".")
  if ($parts.Length -ne 3) {
    throw "无法解析版本号：$Version"
  }

  return [pscustomobject]@{
    Major = [int]$parts[0]
    Minor = [int]$parts[1]
    Patch = [int]$parts[2]
  }
}

function Get-NextVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$Mode
  )

  $parts = Convert-VersionToParts -Version $Version
  switch ($Mode) {
    "major" { return "{0}.0.0" -f ($parts.Major + 1) }
    "minor" { return "{0}.{1}.0" -f $parts.Major, ($parts.Minor + 1) }
    default { return "{0}.{1}.{2}" -f $parts.Major, $parts.Minor, ($parts.Patch + 1) }
  }
}

function Quote-CommandLineArgument {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  if ($Value.Length -eq 0) {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Test-WorkingTreeDirty {
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCommand) {
    return [pscustomobject]@{
      IsDirty = $false
      Message = "未检测到 Git，按当前目录内容打包。"
      Level = "info"
    }
  }

  try {
    $statusOutput = & $gitCommand.Source -C $repoRoot status --porcelain 2>$null
    if ($LASTEXITCODE -ne 0) {
      return [pscustomobject]@{
        IsDirty = $false
        Message = "Git 状态检测失败，仍可继续按当前目录内容打包。"
        Level = "warn"
      }
    }

    if ($statusOutput) {
      return [pscustomobject]@{
        IsDirty = $true
        Message = "检测到未提交改动，打包将基于当前工作区内容继续。"
        Level = "warn"
      }
    }

    return [pscustomobject]@{
      IsDirty = $false
      Message = "工作区干净，可以直接打包。"
      Level = "info"
    }
  } catch {
    return [pscustomobject]@{
      IsDirty = $false
      Message = "无法检测 Git 状态，仍可继续打包。"
      Level = "warn"
    }
  }
}

function Append-Log {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  if ([string]::IsNullOrWhiteSpace($Message)) {
    return
  }

  $timestamp = Get-Date -Format "HH:mm:ss"
  $logTextBox.AppendText("[$timestamp] $Message{0}" -f [Environment]::NewLine)
  $logTextBox.SelectionStart = $logTextBox.TextLength
  $logTextBox.ScrollToCaret()
}

function Set-StatusText {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message,
    [string]$ColorName = "DimGray"
  )

  $statusLabel.Text = $Message
  $statusLabel.ForeColor = [System.Drawing.Color]::FromName($ColorName)
}

function Refresh-DirtyState {
  $state = Test-WorkingTreeDirty
  $dirtyLabel.Text = $state.Message

  if ($state.Level -eq "warn") {
    $dirtyLabel.ForeColor = [System.Drawing.Color]::FromArgb(184, 92, 0)
  } else {
    $dirtyLabel.ForeColor = [System.Drawing.Color]::FromArgb(70, 70, 70)
  }
}

function Update-TargetVersionPreview {
  $mode = [string]$modeComboBox.SelectedItem
  if (-not $mode) {
    return
  }

  if ($mode -eq "manual") {
    $targetVersionTextBox.ReadOnly = $false
    if (-not $targetVersionTextBox.Text) {
      $targetVersionTextBox.Text = $script:currentVersion
    }
    return
  }

  $targetVersionTextBox.ReadOnly = $true
  $targetVersionTextBox.Text = Get-NextVersion -Version $script:currentVersion -Mode $mode
}

function Set-UiEnabled {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Enabled
  )

  $modeComboBox.Enabled = $Enabled
  $startButton.Enabled = $Enabled
  if ([string]$modeComboBox.SelectedItem -eq "manual") {
    $targetVersionTextBox.ReadOnly = -not $Enabled
  } else {
    $targetVersionTextBox.ReadOnly = $true
  }
}

function Open-ArtifactDirectory {
  if (-not (Test-Path -LiteralPath $artifactDirectory)) {
    [System.Windows.Forms.MessageBox]::Show(
      "输出目录尚未生成：`n$artifactDirectory",
      "打开目录失败",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    return
  }

  Start-Process explorer.exe -ArgumentList @($artifactDirectory)
}

function Handle-StructuredEvent {
  param(
    [Parameter(Mandatory = $true)]
    $Payload
  )

  switch ([string]$Payload.type) {
    "meta" {
      if ($Payload.currentVersion) {
        $script:currentVersion = [string]$Payload.currentVersion
        $currentVersionTextBox.Text = $script:currentVersion
      }
      if ($Payload.targetVersion) {
        $targetVersionTextBox.Text = [string]$Payload.targetVersion
      }
      Set-StatusText -Message ([string]$Payload.message)
      return
    }
    "status" {
      if ($Payload.message) {
        Append-Log ([string]$Payload.message)
        Set-StatusText -Message ([string]$Payload.message)
      }
      return
    }
    "artifact" {
      $script:lastArtifactPath = [string]$Payload.path
      Append-Log ("安装包路径：{0}" -f $script:lastArtifactPath)
      Set-StatusText -Message "安装包已生成" -ColorName "ForestGreen"
      return
    }
    "error" {
      Append-Log ("错误：{0}" -f [string]$Payload.message)
      Set-StatusText -Message "打包失败" -ColorName "Crimson"
      return
    }
    "done" {
      $script:receivedDoneEvent = $true
      if ($Payload.success -eq $true) {
        if ($Payload.targetVersion) {
          $script:currentVersion = [string]$Payload.targetVersion
          $currentVersionTextBox.Text = $script:currentVersion
        }
        Update-TargetVersionPreview
        Set-StatusText -Message "打包完成" -ColorName "ForestGreen"
        Append-Log "打包完成。"
      } else {
        Set-StatusText -Message "打包失败" -ColorName "Crimson"
        Append-Log "打包失败。"
      }
      return
    }
  }
}

function Handle-OutputLine {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Line,
    [Parameter(Mandatory = $true)]
    [ValidateSet("stdout", "stderr")]
    [string]$Source
  )

  if ([string]::IsNullOrWhiteSpace($Line)) {
    return
  }

  if ($Source -eq "stdout" -and $Line.StartsWith("SBPACK_JSON ")) {
    $jsonText = $Line.Substring("SBPACK_JSON ".Length)
    try {
      $payload = $jsonText | ConvertFrom-Json
      Handle-StructuredEvent -Payload $payload
    } catch {
      Write-UiLog ("Failed to parse structured log line: {0}" -f $Line)
      Append-Log ("无法解析结构化日志：{0}" -f $Line)
    }
    return
  }

  Append-Log $Line
}

function Start-Packaging {
  if ($script:isPackaging) {
    return
  }

  Refresh-DirtyState

  $mode = [string]$modeComboBox.SelectedItem
  if (-not $mode) {
    [System.Windows.Forms.MessageBox]::Show(
      "请选择版本策略。",
      "无法开始打包",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    return
  }

  $targetVersion = $targetVersionTextBox.Text.Trim()
  if ($mode -eq "manual" -and $targetVersion -notmatch $semverPattern) {
    [System.Windows.Forms.MessageBox]::Show(
      "请输入合法的语义化版本号，例如 2.1.2。",
      "版本号无效",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    return
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    [System.Windows.Forms.MessageBox]::Show(
      "未找到 node.exe，请先安装或配置 Node.js。",
      "无法开始打包",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return
  }

  $arguments = @($nodeScriptPath, "--bump", $mode, "--bundle", "nsis")
  if ($mode -eq "manual") {
    $arguments += @("--version", $targetVersion)
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodeCommand.Source
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  if ($startInfo.PSObject.Properties.Name -contains "StandardOutputEncoding") {
    $startInfo.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
  }
  if ($startInfo.PSObject.Properties.Name -contains "StandardErrorEncoding") {
    $startInfo.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
  }

  $startInfo.Arguments = ($arguments | ForEach-Object { Quote-CommandLineArgument -Value $_ }) -join " "

  $script:packageProcess = New-Object System.Diagnostics.Process
  $script:packageProcess.StartInfo = $startInfo
  $script:packageProcess.EnableRaisingEvents = $true
  $script:receivedDoneEvent = $false
  $script:lastArtifactPath = ""
  $script:isPackaging = $true

  Set-UiEnabled -Enabled $false
  Append-Log ("开始打包，目标版本：{0}" -f $targetVersion)
  Set-StatusText -Message "正在启动打包流程..."

  $script:packageProcess.add_OutputDataReceived({
      param($sender, $eventArgs)
      $line = $eventArgs.Data
      if ($null -eq $line) {
        return
      }
      $capturedLine = [string]$line
      Invoke-OnUiThread ({
          try {
            Handle-OutputLine -Line $capturedLine -Source "stdout"
          } catch {
            Write-UiLog ("Unhandled stdout handler exception: {0}" -f $_.Exception.ToString())
            throw
          }
        }.GetNewClosure())
    })

  $script:packageProcess.add_ErrorDataReceived({
      param($sender, $eventArgs)
      $line = $eventArgs.Data
      if ($null -eq $line) {
        return
      }
      $capturedLine = [string]$line
      Invoke-OnUiThread ({
          try {
            Handle-OutputLine -Line $capturedLine -Source "stderr"
          } catch {
            Write-UiLog ("Unhandled stderr handler exception: {0}" -f $_.Exception.ToString())
            throw
          }
        }.GetNewClosure())
    })

  $script:packageProcess.add_Exited({
      param($sender, $eventArgs)
      $exitCode = $sender.ExitCode
      $processToDispose = $sender
      $capturedExitCode = [int]$exitCode
      Invoke-OnUiThread ({
          try {
            $script:isPackaging = $false
            Set-UiEnabled -Enabled $true
            Update-TargetVersionPreview
            Refresh-DirtyState

            if (-not $script:receivedDoneEvent) {
              if ($capturedExitCode -eq 0) {
                Append-Log "打包进程已结束。"
                Set-StatusText -Message "打包进程已结束" -ColorName "ForestGreen"
              } else {
                Append-Log ("打包进程异常退出，退出码：{0}" -f $capturedExitCode)
                Set-StatusText -Message "打包进程异常退出" -ColorName "Crimson"
              }
            }
          } catch {
            Write-UiLog ("Unhandled exit handler exception: {0}" -f $_.Exception.ToString())
            throw
          } finally {
            if ($null -ne $processToDispose) {
              $processToDispose.Dispose()
            }
            $script:packageProcess = $null
          }
        }.GetNewClosure())
    })

  try {
    $null = $script:packageProcess.Start()
    $script:packageProcess.BeginOutputReadLine()
    $script:packageProcess.BeginErrorReadLine()
  } catch {
    $script:isPackaging = $false
    Set-UiEnabled -Enabled $true
    $script:packageProcess.Dispose()
    $script:packageProcess = $null
    Write-UiLog ("Failed to start packaging process: {0}" -f $_.Exception.Message)
    Append-Log ("无法启动打包进程：{0}" -f $_.Exception.Message)
    Set-StatusText -Message "打包进程启动失败" -ColorName "Crimson"
    [System.Windows.Forms.MessageBox]::Show(
      "无法启动打包进程，请检查 Node.js 与脚本文件是否可用。",
      "启动失败",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Windows 一键打包"
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(860, 660)
$form.Size = New-Object System.Drawing.Size(900, 700)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$form.BackColor = [System.Drawing.Color]::White

$container = New-Object System.Windows.Forms.TableLayoutPanel
$container.Dock = "Fill"
$container.Padding = New-Object System.Windows.Forms.Padding(16)
$container.ColumnCount = 1
$container.RowCount = 5
$container.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$container.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$container.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$container.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$container.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$form.Controls.Add($container)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.AutoSize = $true
$titleLabel.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 14, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(32, 32, 32)
$titleLabel.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 10)
$titleLabel.Text = "Windows 安装包一键打包"
$container.Controls.Add($titleLabel, 0, 0)

$formPanel = New-Object System.Windows.Forms.TableLayoutPanel
$formPanel.Dock = "Top"
$formPanel.ColumnCount = 2
$formPanel.RowCount = 4
$formPanel.AutoSize = $true
$formPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 140)))
$formPanel.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))
$formPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$formPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$formPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$formPanel.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize)))
$container.Controls.Add($formPanel, 0, 1)

$currentVersionLabel = New-Object System.Windows.Forms.Label
$currentVersionLabel.Text = "当前版本号"
$currentVersionLabel.TextAlign = "MiddleLeft"
$currentVersionLabel.Dock = "Fill"
$currentVersionLabel.Margin = New-Object System.Windows.Forms.Padding(0, 8, 8, 8)
$formPanel.Controls.Add($currentVersionLabel, 0, 0)

$currentVersionTextBox = New-Object System.Windows.Forms.TextBox
$currentVersionTextBox.ReadOnly = $true
$currentVersionTextBox.Dock = "Fill"
$currentVersionTextBox.Margin = New-Object System.Windows.Forms.Padding(0, 4, 0, 4)
$formPanel.Controls.Add($currentVersionTextBox, 1, 0)

$modeLabel = New-Object System.Windows.Forms.Label
$modeLabel.Text = "版本策略"
$modeLabel.TextAlign = "MiddleLeft"
$modeLabel.Dock = "Fill"
$modeLabel.Margin = New-Object System.Windows.Forms.Padding(0, 8, 8, 8)
$formPanel.Controls.Add($modeLabel, 0, 1)

$modeComboBox = New-Object System.Windows.Forms.ComboBox
$modeComboBox.DropDownStyle = "DropDownList"
$modeComboBox.Dock = "Left"
$modeComboBox.Width = 180
$modeComboBox.Items.AddRange(@("patch", "minor", "major", "manual"))
$modeComboBox.SelectedIndex = 0
$formPanel.Controls.Add($modeComboBox, 1, 1)

$targetVersionLabel = New-Object System.Windows.Forms.Label
$targetVersionLabel.Text = "目标版本号"
$targetVersionLabel.TextAlign = "MiddleLeft"
$targetVersionLabel.Dock = "Fill"
$targetVersionLabel.Margin = New-Object System.Windows.Forms.Padding(0, 8, 8, 8)
$formPanel.Controls.Add($targetVersionLabel, 0, 2)

$targetVersionTextBox = New-Object System.Windows.Forms.TextBox
$targetVersionTextBox.Dock = "Fill"
$targetVersionTextBox.Margin = New-Object System.Windows.Forms.Padding(0, 4, 0, 4)
$formPanel.Controls.Add($targetVersionTextBox, 1, 2)

$bundleLabel = New-Object System.Windows.Forms.Label
$bundleLabel.Text = "安装包类型"
$bundleLabel.TextAlign = "MiddleLeft"
$bundleLabel.Dock = "Fill"
$bundleLabel.Margin = New-Object System.Windows.Forms.Padding(0, 8, 8, 8)
$formPanel.Controls.Add($bundleLabel, 0, 3)

$bundleTextBox = New-Object System.Windows.Forms.TextBox
$bundleTextBox.ReadOnly = $true
$bundleTextBox.Text = "NSIS (.exe)"
$bundleTextBox.Dock = "Fill"
$bundleTextBox.Margin = New-Object System.Windows.Forms.Padding(0, 4, 0, 4)
$formPanel.Controls.Add($bundleTextBox, 1, 3)

$dirtyLabel = New-Object System.Windows.Forms.Label
$dirtyLabel.AutoSize = $true
$dirtyLabel.Margin = New-Object System.Windows.Forms.Padding(0, 12, 0, 12)
$dirtyLabel.ForeColor = [System.Drawing.Color]::FromArgb(184, 92, 0)
$container.Controls.Add($dirtyLabel, 0, 2)

$logTextBox = New-Object System.Windows.Forms.TextBox
$logTextBox.Multiline = $true
$logTextBox.ScrollBars = "Vertical"
$logTextBox.ReadOnly = $true
$logTextBox.Dock = "Fill"
$logTextBox.BackColor = [System.Drawing.Color]::FromArgb(248, 248, 248)
$logTextBox.Font = New-Object System.Drawing.Font("Cascadia Mono", 9)
$container.Controls.Add($logTextBox, 0, 3)

$buttonPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$buttonPanel.FlowDirection = "LeftToRight"
$buttonPanel.AutoSize = $true
$buttonPanel.Dock = "Fill"
$buttonPanel.WrapContents = $false
$buttonPanel.Margin = New-Object System.Windows.Forms.Padding(0, 12, 0, 0)
$container.Controls.Add($buttonPanel, 0, 4)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "开始打包"
$startButton.Width = 120
$startButton.Height = 36
$buttonPanel.Controls.Add($startButton)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = "打开输出目录"
$openButton.Width = 140
$openButton.Height = 36
$buttonPanel.Controls.Add($openButton)

$statusStrip = New-Object System.Windows.Forms.StatusStrip
$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Spring = $true
$statusLabel.TextAlign = "MiddleLeft"
$statusStrip.Items.Add($statusLabel) | Out-Null
$form.Controls.Add($statusStrip)

$modeComboBox.add_SelectedIndexChanged({
    Update-TargetVersionPreview
  })

$startButton.add_Click({
    Start-Packaging
  })

$openButton.add_Click({
    Open-ArtifactDirectory
  })

$form.add_Shown({
    try {
      $script:currentVersion = Get-CurrentVersion
      $currentVersionTextBox.Text = $script:currentVersion
      Update-TargetVersionPreview
      Refresh-DirtyState
      Set-StatusText -Message "准备就绪"
      Append-Log ("当前版本：{0}" -f $script:currentVersion)
      Append-Log "默认策略为 patch，点击【开始打包】即可生成新的 Windows 安装包。"
    } catch {
      Write-UiLog ("Initialization failed: {0}" -f $_.Exception.ToString())
      [System.Windows.Forms.MessageBox]::Show(
        "初始化打包窗口失败：`n$($_.Exception.Message)",
        "初始化失败",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
      ) | Out-Null
      $form.Close()
    }
  })

$form.add_FormClosing({
    param($sender, $eventArgs)
    if ($script:isPackaging) {
      [System.Windows.Forms.MessageBox]::Show(
        "当前正在打包，请等待完成后再关闭窗口。",
        "打包进行中",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
      ) | Out-Null
      $eventArgs.Cancel = $true
    }
  })

try {
  [System.Windows.Forms.Application]::Run($form)
} catch {
  Write-UiLog ("Unhandled UI exception: {0}" -f $_.Exception.ToString())
  [System.Windows.Forms.MessageBox]::Show(
    "打包窗口发生未处理异常：`n$($_.Exception.Message)`n`n详细日志：`n$uiLogPath",
    "未处理异常",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  throw
}
