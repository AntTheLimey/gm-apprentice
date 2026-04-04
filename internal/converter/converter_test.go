package converter

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AntTheLimey/gm-apprentice/internal/gdf"
)

func TestConvertFile(t *testing.T) {
	gdfContent := `[SKILLTYPES]
Combat, Physical

[ADVANTAGES]
<General>
Combat Reflexes, 15, page(B43), cat(Mental, Physical),
    description(Never freeze in a surprise situation.)

[SKILLS]
Karate, DX/H, page(B203), cat(Combat)
`
	// Write GDF content to a temp file with a name that exercises sanitizeDirName
	tmpDir := t.TempDir()
	gdfFile := filepath.Join(tmpDir, "My Book--4th Ed.gdf")
	if err := os.WriteFile(gdfFile, []byte(gdfContent), 0644); err != nil {
		t.Fatalf("write temp gdf: %v", err)
	}

	outDir := t.TempDir()
	if err := ConvertFile(gdfFile, outDir); err != nil {
		t.Fatalf("ConvertFile error: %v", err)
	}

	// The sanitized book subdirectory name should be "my-book-4th-ed"
	bookDir := filepath.Join(outDir, "my-book-4th-ed")
	info, err := os.Stat(bookDir)
	if err != nil {
		t.Fatalf("book subdirectory not created: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("expected a directory for book subdirectory")
	}

	// At least one markdown file must exist in the subdirectory
	entries, err := os.ReadDir(bookDir)
	if err != nil {
		t.Fatalf("read book dir: %v", err)
	}
	var mdFiles []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".md") {
			mdFiles = append(mdFiles, e.Name())
		}
	}
	if len(mdFiles) == 0 {
		t.Fatal("no markdown files found in book subdirectory")
	}

	// SKILLTYPES is in the skip list — skilltypes.md must not exist
	for _, name := range mdFiles {
		if name == "skilltypes.md" {
			t.Error("skilltypes.md should have been skipped")
		}
	}

	// advantages.md and skills.md should both be present
	want := []string{"advantages.md", "skills.md"}
	fileSet := make(map[string]bool, len(mdFiles))
	for _, name := range mdFiles {
		fileSet[name] = true
	}
	for _, w := range want {
		if !fileSet[w] {
			t.Errorf("expected %s to be created, got files: %v", w, mdFiles)
		}
	}
}

func TestConvertSection(t *testing.T) {
	section := gdf.Section{
		Name: "ADVANTAGES",
		Entries: []gdf.Entry{
			{
				Name:       "Combat Reflexes",
				Cost:       "15",
				Subsection: "General",
				Fields: map[string]string{
					"page":        "B43",
					"cat":         "Mental, Physical",
					"description": "Never freeze in a surprise situation.",
				},
			},
		},
	}

	dir := t.TempDir()
	err := ConvertSection(section, dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	outPath := filepath.Join(dir, "advantages.md")
	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("output file not created: %v", err)
	}

	content := string(data)
	if !strings.Contains(content, "Combat Reflexes") {
		t.Error("missing entry name")
	}
	if !strings.Contains(content, "15") {
		t.Error("missing cost")
	}
	if !strings.Contains(content, "B43") {
		t.Error("missing page reference")
	}
}
