# Desktop toast window for @local/dsh-notify-popup.
# Launched by the plugin host through powershell.exe -Sta -File.
# Text comes from environment variables so non-ASCII never crosses the command line.
#   DSH_NOTIFY_TITLE / DSH_NOTIFY_BODY / DSH_NOTIFY_MS / DSH_NOTIFY_SOUND / DSH_NOTIFY_LOG
$ErrorActionPreference = 'Stop'

function Write-Log([string]$msg) {
  $path = $env:DSH_NOTIFY_LOG
  if ([string]::IsNullOrWhiteSpace($path)) { return }
  try {
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -LiteralPath $path -Value "$stamp $msg" -Encoding UTF8
  } catch { }
}

try {
  Add-Type -AssemblyName PresentationFramework
  Add-Type -AssemblyName PresentationCore
  Add-Type -AssemblyName WindowsBase

  function Esc([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return '' }
    return [System.Security.SecurityElement]::Escape($s)
  }

  $title = [string]$env:DSH_NOTIFY_TITLE
  if ([string]::IsNullOrWhiteSpace($title)) { $title = 'DeepSeek Harness' }
  $body = [string]$env:DSH_NOTIFY_BODY
  if ([string]::IsNullOrWhiteSpace($body)) { $body = ' ' }

  $ms = 9000
  $parsed = 0
  if ([int]::TryParse([string]$env:DSH_NOTIFY_MS, [ref]$parsed)) {
    if ($parsed -ge 1500) { $ms = $parsed }
  }
  $useSound = ($env:DSH_NOTIFY_SOUND -eq '1')

  $safeTitle = Esc $title
  $safeBody = Esc $body

  $xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize"
        SizeToContent="WidthAndHeight" WindowStartupLocation="Manual" Opacity="0">
  <Border CornerRadius="14" Background="#F2181D2B" BorderBrush="#FF4C8DFF" BorderThickness="1"
          Padding="18,15" MaxWidth="420" MinWidth="280">
    <Border.Effect>
      <DropShadowEffect BlurRadius="20" ShadowDepth="4" Opacity="0.5" Color="#000000"/>
    </Border.Effect>
    <StackPanel>
      <TextBlock Text="$safeTitle" Foreground="#FFF3F7FF" FontFamily="Microsoft YaHei UI" FontSize="15" FontWeight="SemiBold" TextWrapping="Wrap"/>
      <TextBlock Text="$safeBody" Foreground="#FFAFBBD0" FontFamily="Microsoft YaHei UI" FontSize="12.5" TextWrapping="Wrap" Margin="0,7,0,0"/>
    </StackPanel>
  </Border>
</Window>
"@

  $doc = New-Object System.Xml.XmlDocument
  $doc.LoadXml($xaml)
  $win = [System.Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $doc))
  if ($null -eq $win) { throw 'XamlReader returned null window' }

  $win.Add_Loaded({
    $w = $this
    try {
      $wa = [System.Windows.SystemParameters]::WorkArea
      $w.Left = [double]($wa.Right - $w.ActualWidth - 24)
      $w.Top = [double]($wa.Bottom - $w.ActualHeight - 24)
      $anim = New-Object System.Windows.Media.Animation.DoubleAnimation
      $anim.From = 0.0
      $anim.To = 1.0
      $anim.Duration = New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds(180))
      $w.BeginAnimation([System.Windows.Window]::OpacityProperty, $anim)
      if ($useSound) { [System.Media.SystemSounds]::Asterisk.Play() }
    } catch {
      Write-Log "loaded-handler: $($_.Exception.Message)"
      $w.Opacity = 1.0
    }
  })

  $win.Add_MouseLeftButtonDown({ $this.Close() })

  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds($ms)
  $timer.Add_Tick({
    $t = $this
    $t.Stop()
    $w = $t.Tag
    if ($w) { $w.Close() }
  })
  $timer.Tag = $win

  Write-Log "show title=$title ms=$ms"
  [void]$win.ShowDialog()
  Write-Log 'closed'
} catch {
  Write-Log "fatal: $($_.Exception.Message) | $($_.ScriptStackTrace)"
  exit 1
}
