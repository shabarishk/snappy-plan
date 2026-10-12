package backend

import (
	"embed"
	"io/fs"
)

//go:embed all:web/dist
var frontendAssets embed.FS

func FrontendFiles() (fs.FS, error) {
	return fs.Sub(frontendAssets, "web/dist")
}
