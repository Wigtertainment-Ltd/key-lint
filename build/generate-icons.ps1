# Generates every app icon variant from build/logo.png.
# Run with: powershell -ExecutionPolicy Bypass -File build/generate-icons.ps1
# Requires Windows PowerShell (System.Drawing), no npm dependencies.

[CmdletBinding()]
param(
	[string]$Source
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$buildDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $buildDir
$publicDir = Join-Path $repoRoot 'public'
if (-not $Source) { $Source = Join-Path $buildDir 'logo.png' }

# Dark brand background (--bg of the dark theme) for icons that must not be transparent.
$brandBackground = '#0d0b2e'

function Get-ContentBounds {
	param([System.Drawing.Bitmap]$Bitmap)

	$rect = New-Object System.Drawing.Rectangle 0, 0, $Bitmap.Width, $Bitmap.Height
	$data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	try {
		$stride = $data.Stride
		$bytes = New-Object byte[] ($stride * $Bitmap.Height)
		[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
	} finally {
		$Bitmap.UnlockBits($data)
	}

	$minX = $Bitmap.Width; $minY = $Bitmap.Height; $maxX = -1; $maxY = -1
	for ($y = 0; $y -lt $Bitmap.Height; $y++) {
		$row = $y * $stride
		for ($x = 0; $x -lt $Bitmap.Width; $x++) {
			# BGRA layout, alpha is the 4th byte.
			if ($bytes[$row + ($x * 4) + 3] -gt 8) {
				if ($x -lt $minX) { $minX = $x }
				if ($x -gt $maxX) { $maxX = $x }
				if ($y -lt $minY) { $minY = $y }
				if ($y -gt $maxY) { $maxY = $y }
			}
		}
	}

	if ($maxX -lt 0) { throw "Source image '$Source' is fully transparent." }
	return New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
}

function New-SquareIcon {
	param(
		[System.Drawing.Bitmap]$Bitmap,
		[System.Drawing.Rectangle]$Bounds,
		[int]$Size,
		[double]$Margin = 0.08,
		[string]$Background = ''
	)

	$canvas = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$graphics = [System.Drawing.Graphics]::FromImage($canvas)
	try {
		$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
		$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
		$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
		$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

		if ($Background) {
			$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($Background))
		} else {
			$graphics.Clear([System.Drawing.Color]::Transparent)
		}

		$inner = $Size * (1.0 - (2.0 * $Margin))
		$scale = [Math]::Min($inner / $Bounds.Width, $inner / $Bounds.Height)
		$width = $Bounds.Width * $scale
		$height = $Bounds.Height * $scale
		$destination = New-Object System.Drawing.RectangleF (($Size - $width) / 2.0), (($Size - $height) / 2.0), $width, $height

		$attributes = New-Object System.Drawing.Imaging.ImageAttributes
		$attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
		$graphics.DrawImage(
			$Bitmap,
			[System.Drawing.Rectangle]::Round($destination),
			$Bounds.X, $Bounds.Y, $Bounds.Width, $Bounds.Height,
			[System.Drawing.GraphicsUnit]::Pixel,
			$attributes
		)
		$attributes.Dispose()
	} finally {
		$graphics.Dispose()
	}

	return $canvas
}

function Save-Png {
	param([System.Drawing.Bitmap]$Bitmap, [string]$Path)

	$Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
	Write-Host "  $([IO.Path]::GetFileName($Path)) ($($Bitmap.Width)x$($Bitmap.Height))"
}

function Save-Ico {
	param([System.Drawing.Bitmap[]]$Bitmaps, [string]$Path)

	$payloads = @()
	foreach ($bitmap in $Bitmaps) {
		$stream = New-Object System.IO.MemoryStream
		$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
		$payloads += , @{ Size = $bitmap.Width; Bytes = $stream.ToArray() }
		$stream.Dispose()
	}

	$file = [System.IO.File]::Create($Path)
	$writer = New-Object System.IO.BinaryWriter $file
	try {
		$writer.Write([uint16]0)                  # reserved
		$writer.Write([uint16]1)                  # type: icon
		$writer.Write([uint16]$payloads.Count)

		$offset = 6 + (16 * $payloads.Count)
		foreach ($payload in $payloads) {
			$dimension = if ($payload.Size -ge 256) { 0 } else { $payload.Size }
			$writer.Write([byte]$dimension)        # width
			$writer.Write([byte]$dimension)        # height
			$writer.Write([byte]0)                 # palette colors
			$writer.Write([byte]0)                 # reserved
			$writer.Write([uint16]1)               # color planes
			$writer.Write([uint16]32)              # bits per pixel
			$writer.Write([uint32]$payload.Bytes.Length)
			$writer.Write([uint32]$offset)
			$offset += $payload.Bytes.Length
		}

		foreach ($payload in $payloads) {
			$writer.Write($payload.Bytes)
		}
	} finally {
		$writer.Dispose()
		$file.Dispose()
	}

	Write-Host "  $([IO.Path]::GetFileName($Path)) ($($payloads.Count) sizes)"
}

$sourceImage = New-Object System.Drawing.Bitmap $Source
try {
	$bounds = Get-ContentBounds -Bitmap $sourceImage
	Write-Host "Source: $Source ($($sourceImage.Width)x$($sourceImage.Height)), content bounds $($bounds.Width)x$($bounds.Height) at $($bounds.X),$($bounds.Y)"

	Write-Host 'public/'
	# Browser tab / PWA icons - transparent so they blend into light and dark tab bars.
	foreach ($size in 16, 32, 48) {
		$icon = New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size $size -Margin 0.04
		Save-Png -Bitmap $icon -Path (Join-Path $publicDir "favicon-${size}x${size}.png")
		$icon.Dispose()
	}
	foreach ($size in 192, 512) {
		$icon = New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size $size -Margin 0.04
		Save-Png -Bitmap $icon -Path (Join-Path $publicDir "icon-${size}.png")
		$icon.Dispose()
	}

	$icoSizes = 16, 24, 32, 48, 64, 128, 256
	$icoBitmaps = $icoSizes | ForEach-Object { New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size $_ -Margin 0.04 }
	Save-Ico -Bitmaps $icoBitmaps -Path (Join-Path $publicDir 'favicon.ico')
	$icoBitmaps | ForEach-Object { $_.Dispose() }

	# iOS home screen icons are composited on black when transparent - keep them opaque.
	$appleIcon = New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size 180 -Margin 0.12 -Background $brandBackground
	Save-Png -Bitmap $appleIcon -Path (Join-Path $publicDir 'apple-touch-icon.png')
	$appleIcon.Dispose()

	# Maskable icon: 40% safe-zone padding so Android can crop it to any shape.
	$maskable = New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size 512 -Margin 0.2 -Background $brandBackground
	Save-Png -Bitmap $maskable -Path (Join-Path $publicDir 'maskable-icon-512.png')
	$maskable.Dispose()

	# In-app brand mark.
	$logo = New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size 512 -Margin 0.0
	Save-Png -Bitmap $logo -Path (Join-Path $publicDir 'logo.png')
	$logo.Dispose()

	Write-Host 'build/'
	# electron-builder input: 1024x1024 PNG plus a multi-size .ico for the Windows shell.
	$appIcon = New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size 1024 -Margin 0.08
	Save-Png -Bitmap $appIcon -Path (Join-Path $buildDir 'icon.png')
	$appIcon.Dispose()

	$appIcoBitmaps = $icoSizes | ForEach-Object { New-SquareIcon -Bitmap $sourceImage -Bounds $bounds -Size $_ -Margin 0.08 }
	Save-Ico -Bitmaps $appIcoBitmaps -Path (Join-Path $buildDir 'icon.ico')
	$appIcoBitmaps | ForEach-Object { $_.Dispose() }
} finally {
	$sourceImage.Dispose()
}

Write-Host 'Done.'
