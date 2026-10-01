Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)
$rect=New-Object System.Drawing.Rectangle(1150,450,770,830)
$crop=$bmp.Clone($rect,$bmp.PixelFormat)
$crop.Save('D:\zcode_date\clever-the-skadi\test\desktop2.png')
$g.Dispose();$bmp.Dispose();$crop.Dispose()
'ok'
