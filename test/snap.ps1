Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type 'using System;using System.Runtime.InteropServices;public struct RECT{public int L,T,R,B;public class W{[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,ref RECT r);}}'
$p=Get-Process electron,SkadiPet -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -eq 'SkadiPet'} | Select-Object -First 1
if (-not $p) { Write-Output 'window not found'; exit 1 }
$r=New-Object 'RECT'
[RECT+W]::GetWindowRect($p.MainWindowHandle,[ref]$r) | Out-Null
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$x=[Math]::Max(0,$r.L-50); $y=[Math]::Max(0,$r.T-50)
$w=[Math]::Min($b.Width-$x,$r.R-$r.L+100); $h=[Math]::Min($b.Height-$y,$r.B-$r.T+100)
$bmp=New-Object System.Drawing.Bitmap $w,$h
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x,$y,0,0,$bmp.Size)
$bmp.Save('D:\zcode_date\clever-the-skadi\test\pet.png')
$g.Dispose();$bmp.Dispose()
Write-Output ("ok "+$x+","+($r.T)+" "+$w+"x"+$h)
